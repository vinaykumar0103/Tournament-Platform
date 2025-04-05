import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';

const TournamentPlatformABI = (await import('../src/abi/TournamentPlatformABI.json', { assert: { type: 'json' } })).default;

const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://localhost:5173' }));

const { SEPOLIA_RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;
if (!SEPOLIA_RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    console.error('Missing environment variables. Check .env file.');
    process.exit(1);
}

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, TournamentPlatformABI, wallet);

// Middleware to check if the backend wallet is the contract owner
const checkOwner = async (req, res, next) => {
    try {
        const contractOwner = await contract.owner();
        if (wallet.address.toLowerCase() !== contractOwner.toLowerCase()) {
            return res.status(403).json({ success: false, error: 'Only the contract owner can perform this action' });
        }
        next();
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to verify owner', details: error.message });
    }
};

// Verify ownership
(async () => {
    const owner = await contract.owner();
    console.log(`Contract Owner: ${owner}`);
    console.log(`Backend Wallet: ${wallet.address}`);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        console.error('Warning: Backend wallet is not the contract owner!');
    }
})();

// Submit Score
app.post('/submit-score', async (req, res) => {
    try {
        const { tournamentId, player, score } = req.body;
        if (!tournamentId || !player || !score) {
            return res.status(400).json({ success: false, error: 'All fields required' });
        }
        const tx = await contract.submitScore(tournamentId, player, score, { gasLimit: 200000 });
        await tx.wait();
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error('Submit Score Error:', error);
        res.status(500).json({ success: false, error: error.reason || error.message });
    }
});

// finalize-tournament
app.post('/finalize-tournament', async (req, res) => {
    try {
        const { tournamentId } = req.body;
        if (!tournamentId) {
            return res.status(400).json({ success: false, error: 'Tournament ID required' });
        }
        console.log('Finalizing Tournament:', tournamentId, 'Owner:', wallet.address);
        const [details] = await contract.getTournamentDetails(tournamentId);
        const topPlayers = await contract.getWinners(tournamentId);
        console.log('Tournament Details:', {
            isCanceled: details.isCanceled,
            startTime: Number(details.startTime),
            submissionDeadline: Number(details.submissionDeadline),
            playerCount: Number(details.currentPlayerCount),
            rewardsAssigned: details.rewardsAssigned,
            currentBlockTimestamp: Number(await provider.getBlock('latest').then(b => b.timestamp)),
            topPlayers: topPlayers
        });

        const tx = await contract.finalizeTournament(tournamentId, { gasLimit: 300000 });
        await tx.wait();
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error('Finalize Tournament Error:', error);
        let errorMsg = error.reason || error.message || 'Failed to finalize tournament';
        if (error.code === 'CALL_EXCEPTION') {
            errorMsg = `Transaction reverted: ${error.reason || 'Check conditions'}`;
        }
        res.status(500).json({ success: false, error: errorMsg });
    }
});

// cancel-tournament
app.post('/cancel-tournament', async (req, res) => {
    try {
        const { tournamentId } = req.body;
        if (!tournamentId) {
            return res.status(400).json({ success: false, error: 'Tournament ID is required' });
        }
        console.log('Canceling Tournament:', tournamentId, 'Owner:', wallet.address);
        const tx = await contract.cancelTournament(tournamentId, { gasLimit: 200000 });
        await tx.wait();
        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error('Cancel Tournament Error:', error);
        let errorMsg = error.reason || error.message || 'Unknown error';
        if (error.code === 'CALL_EXCEPTION') {
            errorMsg = 'Transaction reverted: Check contract conditions (e.g., not owner, already canceled)';
        }
        res.status(500).json({ success: false, error: errorMsg });
    }
});

// simulate-game
app.post('/simulate-game', checkOwner, async (req, res) => {
    const { tournamentId, players } = req.body;
    if (!tournamentId || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ success: false, error: 'Missing tournamentId or players array' });
    }
    try {
        const txs = [];
        for (const { address, score } of players) {
            const tx = await contract.submitScore(tournamentId, address, score, { gasLimit: 200000 });
            txs.push(tx.hash);
            await tx.wait();
        }
        res.json({ success: true, txHashes: txs });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to simulate game',
            details: error.message,
            reason: error.reason || 'Unknown error'
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
    console.log(`Using wallet: ${wallet.address}`);
});