// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol"; // Optional NFT

contract TournamentPlatform is ReentrancyGuardUpgradeable, OwnableUpgradeable, UUPSUpgradeable {
    using AddressUpgradeable for address payable;

    uint256 public playerCount;
    mapping(address => uint256) public playerIds;

   // struct
    struct Tournament {
        uint256 entryFee;
        uint256 maxPlayers;
        uint256 startTime;
        string gameType;
        bool isCanceled;
        bool rewardsAssigned;
        uint256 playerCount;
        uint256 totalPrize;
        uint256 submissionDeadline;
        uint256 minPlayers;
        uint256 cancelDeadline;
        uint256 leaderboardId;
        mapping(address => bool) hasJoined;
        mapping(address => uint256) scores;
        mapping(address => uint256) rewards;
        mapping(address => uint256) feesPaid;
        address[3] topPlayers;
        uint256[3] topScores;
        address[] joinedPlayers;
    }

    mapping(uint256 => Tournament) public tournaments;
    uint256 public tournamentCount;
    uint256[] public tournamentIds;
    uint256 public leaderboardIdCounter;

    // Optional NFT integration
    IERC721Upgradeable public nftContract; 

    event PlayerRegistered(address indexed player, uint256 playerId);
    event TournamentCreated(uint256 indexed tournamentId, uint256 startTime, uint256 entryFee, uint256 maxPlayers);
    event PlayerJoined(uint256 indexed tournamentId, address indexed player, uint256 feePaid);
    event ScoreSubmitted(uint256 indexed tournamentId, address indexed player, uint256 score);
    event TournamentFull(uint256 indexed tournamentId);
    event RewardsFinalized(uint256 indexed tournamentId, address indexed winner, uint256 amount, uint256 rank);
    event RewardClaimed(uint256 indexed tournamentId, address indexed winner, uint256 amount);
    event TournamentCanceled(uint256 indexed tournamentId);
    event RefundClaimed(uint256 indexed tournamentId, address indexed player, uint256 amount);

    function initialize() external initializer {
        __ReentrancyGuard_init();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        leaderboardIdCounter = 0;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Optional: Set NFT contract for badges/trophies
    function setNFTContract(address _nftContract) external onlyOwner {
        nftContract = IERC721Upgradeable(_nftContract);
    }

    function registerPlayer() external {
        require(playerIds[msg.sender] == 0, "Already registered");
        unchecked { playerCount += 1; }
        playerIds[msg.sender] = playerCount;
        emit PlayerRegistered(msg.sender, playerCount);
    }

  // createNew Tournament
    function createNewTournament(
        uint256 _entryFee,
        uint256 _maxPlayers,
        uint256 _startDelay,
        string calldata _gameType,
        uint256 _cancelDelay
    ) external onlyOwner {
        require(_entryFee > 0, "Entry fee must be positive");
        require(_maxPlayers > 0, "Max players must be positive");
        require(_startDelay > 0, "Start delay must be positive");
        require(_cancelDelay > 0 && _cancelDelay < _startDelay, "Cancel delay must be between now and start");

        unchecked { tournamentCount += 1; }
        Tournament storage t = tournaments[tournamentCount];
        
        t.entryFee = _entryFee;
        t.maxPlayers = _maxPlayers;
        t.startTime = block.timestamp + _startDelay;
        t.gameType = _gameType;
        t.submissionDeadline = t.startTime + 1 days;
        t.minPlayers = _maxPlayers / 2;
        t.cancelDeadline = block.timestamp + _cancelDelay;
        unchecked { leaderboardIdCounter += 1; }
        t.leaderboardId = leaderboardIdCounter;

        tournamentIds.push(tournamentCount);
        emit TournamentCreated(tournamentCount, t.startTime, _entryFee, _maxPlayers);
    }
   
   // JoinTournament
    function joinTournament(uint256 _tournamentId) external payable nonReentrant {
        Tournament storage t = tournaments[_tournamentId];
        require(_tournamentId <= tournamentCount, "Invalid tournament ID");
        require(t.startTime > block.timestamp, "Tournament has started");
        require(t.playerCount < t.maxPlayers, "Tournament is full");
        require(!t.isCanceled, "Tournament canceled");
        require(!t.hasJoined[msg.sender], "Already joined");
        require(t.playerCount < t.minPlayers || t.cancelDeadline >= block.timestamp, "Tournament will be canceled");

        uint256 fee = t.entryFee;
        if (address(nftContract) != address(0) && nftContract.balanceOf(msg.sender) > 0) {
            fee = fee * 90 / 100; // 10% discount for NFT holders
        }
        require(msg.value == fee, "Wrong ETH fee: expected entryFee amount");

        t.hasJoined[msg.sender] = true;
        t.feesPaid[msg.sender] = msg.value;
        t.joinedPlayers.push(msg.sender);
        unchecked { t.playerCount += 1; }
        unchecked { t.totalPrize += msg.value; }
        
        emit PlayerJoined(_tournamentId, msg.sender, msg.value);
        if (t.playerCount == t.maxPlayers) {
            emit TournamentFull(_tournamentId);
        }
    }
    
    //  CancelTournament
    function cancelTournament(uint256 _tournamentId) external onlyOwner {
        Tournament storage t = tournaments[_tournamentId];
        require(_tournamentId <= tournamentCount, "Invalid ID");
        require(!t.isCanceled, "Already canceled");
        t.isCanceled = true;
        emit TournamentCanceled(_tournamentId);
    }
   

   // ClaimRefund
    function claimRefund(uint256 _tournamentId) external nonReentrant {
        Tournament storage t = tournaments[_tournamentId];
        require(t.isCanceled, "Not canceled");
        require(t.hasJoined[msg.sender], "Not joined");
        uint256 fee = t.feesPaid[msg.sender];
        require(fee > 0, "No refund");

        t.feesPaid[msg.sender] = 0;
        payable(msg.sender).sendValue(fee);
        emit RefundClaimed(_tournamentId, msg.sender, fee);
    }
  
  // SubmitScore
    function submitScore(uint256 _tournamentId, address _player, uint256 _score) external onlyOwner {
        Tournament storage t = tournaments[_tournamentId];
        require(_tournamentId <= tournamentCount, "Invalid ID");
        require(block.timestamp <= t.submissionDeadline, "Closed");
        require(t.hasJoined[_player], "Not joined");
        require(t.scores[_player] == 0, "Score set");

        t.scores[_player] = _score;

        if (_score > t.topScores[0]) {
            t.topScores[2] = t.topScores[1];
            t.topPlayers[2] = t.topPlayers[1];
            t.topScores[1] = t.topScores[0];
            t.topPlayers[1] = t.topPlayers[0];
            t.topScores[0] = _score;
            t.topPlayers[0] = _player;
        } else if (_score > t.topScores[1]) {
            t.topScores[2] = t.topScores[1];
            t.topPlayers[2] = t.topPlayers[1];
            t.topScores[1] = _score;
            t.topPlayers[1] = _player;
        } else if (_score > t.topScores[2]) {
            t.topScores[2] = _score;
            t.topPlayers[2] = _player;
        }

        emit ScoreSubmitted(_tournamentId, _player, _score);
    }

   // FinalizeTournament
    function finalizeTournament(uint256 _tournamentId) external onlyOwner {
        Tournament storage t = tournaments[_tournamentId];
        require(_tournamentId <= tournamentCount, "Invalid ID");
        require(block.timestamp > t.submissionDeadline, "Not closed");
        require(!t.isCanceled, "Canceled");
        require(!t.rewardsAssigned, "Already finalized");
        require(t.topPlayers[0] != address(0), "No winners assigned");

        t.rewards[t.topPlayers[0]] = t.totalPrize * 50 / 100;
        t.rewards[t.topPlayers[1]] = t.totalPrize * 30 / 100;
        t.rewards[t.topPlayers[2]] = t.totalPrize * 20 / 100;

        emit RewardsFinalized(_tournamentId, t.topPlayers[0], t.rewards[t.topPlayers[0]], 1);
        emit RewardsFinalized(_tournamentId, t.topPlayers[1], t.rewards[t.topPlayers[1]], 2);
        emit RewardsFinalized(_tournamentId, t.topPlayers[2], t.rewards[t.topPlayers[2]], 3);

        // Optional NFT trophies
        if (address(nftContract) != address(0)) {
            nftContract.safeTransferFrom(owner(), t.topPlayers[0], tournamentCount * 10 + 1); // 1st place NFT
            nftContract.safeTransferFrom(owner(), t.topPlayers[1], tournamentCount * 10 + 2); // 2nd place NFT
            nftContract.safeTransferFrom(owner(), t.topPlayers[2], tournamentCount * 10 + 3); // 3rd place NFT
        }

        t.rewardsAssigned = true;
        t.totalPrize = 0;
    }

   // ClaimRewards
    function claimRewards(uint256 _tournamentId) external nonReentrant {
        Tournament storage t = tournaments[_tournamentId];
        uint256 reward = t.rewards[msg.sender];
        require(reward > 0, "Nothing to claim");

        t.rewards[msg.sender] = 0;
        payable(msg.sender).sendValue(reward);
        emit RewardClaimed(_tournamentId, msg.sender, reward);
    }

    // GetTournamentDetails
    function getTournamentDetails(uint256 _tournamentId) external view returns (
        uint256 entryFee,
        uint256 maxPlayers,
        uint256 startTime,
        string memory gameType,
        bool isCanceled,
        bool rewardsAssigned,
        uint256 currentPlayerCount,
        uint256 totalPrize,
        uint256 submissionDeadline,
        uint256 minPlayers,
        uint256 cancelDeadline,
        uint256 leaderboardId
    ) {
        Tournament storage t = tournaments[_tournamentId];
        return (
            t.entryFee,
            t.maxPlayers,
            t.startTime,
            t.gameType,
            t.isCanceled,
            t.rewardsAssigned,
            t.playerCount,
            t.totalPrize,
            t.submissionDeadline,
            t.minPlayers,
            t.cancelDeadline,
            t.leaderboardId
        );
    }

    // GetWinners

    function getWinners(uint256 _tournamentId) external view returns (address first, address second, address third) {
        Tournament storage t = tournaments[_tournamentId];
        return (t.topPlayers[0], t.topPlayers[1], t.topPlayers[2]);
    }

    // GetTournamentPlayers
    function getTournamentPlayers(uint256 _tournamentId) external view returns (address[] memory) {
        require(_tournamentId <= tournamentCount, "Invalid ID");
        return tournaments[_tournamentId].joinedPlayers;
    }

   // GetLeaderboardId
    function getLeaderboardId(uint256 _tournamentId) external view returns (uint256) {
        require(_tournamentId <= tournamentCount, "Invalid ID");
        return tournaments[_tournamentId].leaderboardId;
    }
    
    // GetEntryFee
    function getEntryFee(uint256 _tournamentId) external view returns (uint256) {
        require(_tournamentId <= tournamentCount, "Invalid ID");
        return tournaments[_tournamentId].entryFee;
    }
}