import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import TournamentPlatformABI from './abi/TournamentPlatformABI.json'; // Import the ABI file
import './App.css';

// contract address and backend URL
const CONTRACT_ADDRESS = '0x794F79EeB6Bdd24B20D78B7F34b72C2d2aB15d5e'; // Contract address
const BACKEND_URL = 'http://localhost:3001'; // Backend URL
const SEPOLIA_CHAIN_ID = '11155111'; // Sepolia chain ID

// Main App component
function App() {
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [status, setStatus] = useState('');

// Connect to MetaMask wallet and fetch account details
  const connectWallet = async (Switch = false) => {
    if (!window.ethereum) {
      setStatus('MetaMask not detected!');
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId.toString() !== SEPOLIA_CHAIN_ID) {
        setStatus('Please switch to Sepolia network in MetaMask');
        return;
      }
      let accounts;
      if (Switch) {
        await provider.send('wallet_requestPermissions', [{ eth_accounts: {} }]);
        accounts = await provider.send('eth_requestAccounts', []);
      } else {
        accounts = await provider.send('eth_requestAccounts', []);
      }
      const signer = await provider.getSigner();
      const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, TournamentPlatformABI, signer);
      const connectedAccount = accounts[0];
      setContract(contractInstance);
      setAccount(connectedAccount);

      const owner = await contractInstance.owner();
      const isOwnerCheck = connectedAccount.toLowerCase() === owner.toLowerCase();
      setIsOwner(isOwnerCheck);
      console.log('Connected Account:', connectedAccount, 'Owner:', owner, 'Is Owner:', isOwnerCheck);

      const id = BigInt(await contractInstance.playerIds(connectedAccount) || 0n);
      setPlayerId(id > 0n ? id.toString() : null);
      console.log('Player ID:', id > 0n ? id.toString() : 'Not Registered');

      setStatus(`Connected: ${connectedAccount.slice(0, 6)}...${connectedAccount.slice(-4)}${id > 0n ? ` | Player ID: ${id}` : ''}${isOwnerCheck ? ' (Owner)' : ''}`);
      await fetchTournaments(contractInstance);
    } catch (error) {
      if (error.code === 4001) {
        setStatus('Connection rejected by user. Please approve in MetaMask.');
      } else {
        setStatus('Connection failed: ' + error.message);
      }
    }
  };

  const changeWallet = async () => {
    await connectWallet(true);
  };
 
  // Register player 
  const registerPlayer = async () => {
    if (!contract) return setStatus('Connect wallet first');
    try {
      const currentId = BigInt(await contract.playerIds(account) || 0n);
      if (currentId > 0n) {
        setStatus(`Already registered with Player ID: ${currentId}`);
        setPlayerId(currentId.toString());
        return;
      }
      const tx = await contract.registerPlayer({ gasLimit: 100000 });
      await tx.wait();
      const newId = BigInt(await contract.playerIds(account));
      setPlayerId(newId.toString());
      setStatus(`Registered successfully | Player ID: ${newId}`);
    } catch (error) {
      setStatus('Registration failed: ' + (error.reason || error.message || 'Transaction reverted'));
    }
  };

  // Fetch tournaments
  const fetchTournaments = async (contractInstance) => {
    try {
      const count = Number(await contractInstance.tournamentCount());
      if (count === 0) {
        setTournaments([]);
        setStatus(prev => prev || 'No tournaments available');
        return;
      }
      const tournamentPromises = Array.from({ length: count }, (_, i) =>
        Promise.all([
          contractInstance.getTournamentDetails(i + 1),
          contractInstance.getWinners(i + 1),
          contractInstance.getTournamentPlayers(i + 1),
        ])
          .then(([details, winners, players]) => ({
            id: (i + 1).toString(),
            entryFee: ethers.formatEther(details.entryFee),
            maxPlayers: Number(details.maxPlayers),
            startTime: Number(details.startTime),
            gameType: details.gameType,
            isCanceled: details.isCanceled,
            rewardsAssigned: details.rewardsAssigned,
            playerCount: Number(details.currentPlayerCount),
            totalPrize: ethers.formatEther(details.totalPrize),
            firstPlace: winners[0],
            secondPlace: winners[1],
            thirdPlace: winners[2],
            joinedPlayers: players,
          }))
          .catch(() => null)
      );
      const data = (await Promise.all(tournamentPromises)).filter(t => t !== null);
      setTournaments(data);
      console.log('Tournaments:', data);
      setStatus(prev => prev || 'Tournaments loaded');
    } catch (error) {
      setStatus('Failed to fetch tournaments: ' + error.message);
    }
  };

  // Join tournament
  const joinTournament = async (id) => {
    if (!contract) return setStatus('Connect wallet first');
    if (!playerId) return setStatus('Register first');
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const tournament = tournaments.find(t => t.id === id);
      console.log('Tournament State Before Join:', tournament);
      const entryFee = await contract.getEntryFee(id);
      const balance = await provider.getBalance(account);
      console.log('Joining Tournament:', id, 'Entry Fee:', ethers.formatEther(entryFee), 'Account Balance:', ethers.formatEther(balance), 'Account:', account);
      if (balance < entryFee) {
        throw new Error('Insufficient ETH balance to pay entry fee');
      }
      const tx = await contract.joinTournament(id, { value: entryFee, gasLimit: 300000 });
      await tx.wait();
      setStatus(`Joined Tournament ${id}`);
      await fetchTournaments(contract);
    } catch (error) {
      console.error('Join Error:', error);
      setStatus('Join failed: ' + (error.reason || error.message || 'Transaction reverted'));
    }
  };

  // Create tournament
  const createTournament = async () => {
    if (!contract || !isOwner) return setStatus('Only owner can create tournaments');
    const entryFee = prompt('Entry Fee (ETH):');
    const maxPlayers = prompt('Max Players:');
    const startDelay = prompt('Start Delay (seconds):');
    const gameType = prompt('Game Type:');
    const cancelDelay = prompt('Cancel Delay (seconds):');
    if (!entryFee || !maxPlayers || !startDelay || !gameType || !cancelDelay) {
      return setStatus('All fields required');
    }
    try {
      const feeInWei = ethers.parseEther(entryFee);
      const tx = await contract.createNewTournament(feeInWei, Number(maxPlayers), Number(startDelay), gameType, Number(cancelDelay), { gasLimit: 500000 });
      await tx.wait();
      setStatus('Tournament created');
      await fetchTournaments(contract);
    } catch (error) {
      setStatus('Creation failed: ' + (error.message || error.reason));
    }
  };


  // Submit score
  const submitScore = async (tournamentId) => {
    if (!isOwner) return setStatus('Only owner can submit scores');
    const player = prompt('Player Address:');
    const score = prompt('Score:');
    if (!player || !score) return setStatus('All fields required');
    try {
      const response = await axios.post(`${BACKEND_URL}/submit-score`, { tournamentId, player, score });
      if (response.data.success) setStatus(`Score submitted: ${response.data.txHash}`);
      else setStatus(`Submit failed: ${response.data.error}`);
      await fetchTournaments(contract);
    } catch (error) {
      console.error('Submit Score Error:', error.response?.data || error.message);
      setStatus(`Error submitting score: ${error.response?.data?.error || error.message}`);
    }
  };

  // Finalize tournament
  const finalizeTournament = async (tournamentId) => {
    if (!isOwner) return setStatus('Only owner can finalize');
    try {
      console.log('Finalizing Tournament ID:', tournamentId);
      const tournament = tournaments.find(t => t.id === tournamentId);
      console.log('Tournament State Before Finalize:', tournament);
      const response = await axios.post(`${BACKEND_URL}/finalize-tournament`, { tournamentId });
      if (response.data.success) {
        setStatus(`Tournament finalized: ${response.data.txHash}`);
      } else {
        setStatus(`Finalize failed: ${response.data.error || 'Unknown error from backend'}`);
      }
      await fetchTournaments(contract);
    } catch (error) {
      console.error('Finalize Tournament Error:', error.response?.data || error.message);
      setStatus(`Error finalizing tournament: ${error.response?.data?.error || error.message}`);
    }
  };

  // Cancel tournament
  const cancelTournament = async (tournamentId) => {
    if (!isOwner) return setStatus('Only owner can cancel');
    try {
      console.log('Canceling Tournament ID:', tournamentId);
      const response = await axios.post(`${BACKEND_URL}/cancel-tournament`, { tournamentId });
      if (response.data.success) {
        setStatus(`Tournament canceled: ${response.data.txHash}`);
      } else {
        setStatus(`Cancel failed: ${response.data.error || 'Unknown error from backend'}`);
      }
      await fetchTournaments(contract);
    } catch (error) {
      console.error('Cancel Tournament Error:', error.response?.data || error.message);
      setStatus(`Error canceling tournament: ${error.response?.data?.error || error.message}`);
    }
  };

// Claim rewards
  const claimRewards = async (id) => {
    if (!contract) return setStatus('Connect wallet first');
    try {
      const tx = await contract.claimRewards(id, { gasLimit: 300000 });
      await tx.wait();
      setStatus(`Rewards claimed for Tournament ${id}`);
      await fetchTournaments(contract);
    } catch (error) {
      setStatus('Claim failed: ' + (error.message || error.reason));
    }
  };

  // Claim refund
  const claimRefund = async (id) => {
    if (!contract) return setStatus('Connect wallet first');
    try {
      const tx = await contract.claimRefund(id, { gasLimit: 300000 });
      await tx.wait();
      setStatus(`Refund claimed for Tournament ${id}`);
      await fetchTournaments(contract);
    } catch (error) {
      setStatus('Refund claim failed: ' + (error.message || error.reason));
    }
  };

  // Handle wallet connection changes
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) {
          connectWallet(false);
        } else {
          setAccount(null);
          setContract(null);
          setPlayerId(null);
          setIsOwner(false);
          setStatus('Wallet disconnected');
        }
      });
    }
  }, []);

  useEffect(() => {
    if (contract && account) fetchTournaments(contract);
  }, [contract, account]);

  const now = Math.floor(Date.now() / 1000);

  // Render the app 
  return (
    <div className="app">
      <header className="header">
        <h1>Tournament Platform</h1>
        {account ? (
          <div className="wallet-info">
            <span>{account.slice(0, 6)}...{account.slice(-4)}{isOwner ? ' (Owner)' : ''}</span>
            <button className="change-wallet-btn" onClick={changeWallet}>Change Wallet</button>
          </div>
        ) : (
          <button className="connect-btn" onClick={() => connectWallet(false)}>Connect Wallet</button>
        )}
      </header>
      <p className="status">{status}</p>
    
    // Display player stats and tournaments
      {account && (
        <div className="dashboard">
          <section className="player-stats">
            <h2>Player Stats</h2>
            <p>Player ID: {playerId || 'Not Registered'}</p>
            <button className="register-btn" onClick={registerPlayer}>Register</button>
          </section>

          {isOwner && (
            <section className="admin-actions">
              <h2>Admin Actions</h2>
              <button className="create-btn" onClick={createTournament}>Create Tournament</button>
            </section>
          )}

        // Display tournaments
          <section className="tournaments">
            <h2>Tournaments</h2>
            {tournaments.length === 0 ? (
              <p>No tournaments available</p>
            ) : (
              tournaments.map((t) => (
                <div key={t.id} className="tournament">
                  <p><strong>#{t.id} - {t.gameType}</strong></p>
                  <p>Fee: {t.entryFee} ETH</p>
                  <p>Players: {t.playerCount}/{t.maxPlayers}</p>
                  <p>Start: {new Date(t.startTime * 1000).toLocaleTimeString()}</p>
                  <p>Status: {t.isCanceled ? 'Canceled' : t.rewardsAssigned ? 'Finished' : t.startTime > now ? 'Upcoming' : 'Active'}</p>
                  <p>Prize: {t.totalPrize} ETH</p>
                  {t.rewardsAssigned && (
                    <div className="leaderboard">
                      <p className="leaderboard-title">Leaderboard:</p>
                      <p>1st: {t.firstPlace ? `${t.firstPlace.slice(0, 6)}...` : 'N/A'} (50%)</p>
                      <p>2nd: {t.secondPlace ? `${t.secondPlace.slice(0, 6)}...` : 'N/A'} (30%)</p>
                      <p>3rd: {t.thirdPlace ? `${t.thirdPlace.slice(0, 6)}...` : 'N/A'} (20%)</p>
                    </div>
                  )}
                  <div className="tournament-actions">
                    {!t.isCanceled && !t.rewardsAssigned && t.playerCount < t.maxPlayers && t.startTime > now && (
                      <button className="join-btn" onClick={() => joinTournament(t.id)}>Join</button>
                    )}
                    {isOwner && !t.isCanceled && !t.rewardsAssigned && t.startTime < now && (
                      <button className="submit-btn" onClick={() => submitScore(t.id)}>Submit Score</button>
                    )}
                    {isOwner && !t.rewardsAssigned && t.playerCount > 0 && t.startTime < now && (
                      <button className="finalize-btn" onClick={() => finalizeTournament(t.id)}>Finalize</button>
                    )}
                    {isOwner && !t.isCanceled && !t.rewardsAssigned && t.startTime > now && (
                      <button className="cancel-btn" onClick={() => cancelTournament(t.id)}>Cancel</button>
                    )}
                    {!t.isCanceled && t.rewardsAssigned && (
                      <button className="claim-rewards-btn" onClick={() => claimRewards(t.id)}>Claim Rewards</button>
                    )}
                    {t.isCanceled && t.joinedPlayers.includes(account) && (
                      <button className="claim-refund-btn" onClick={() => claimRefund(t.id)}>Claim Refund</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default App;