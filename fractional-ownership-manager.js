const express = require('express');
const { createTokenForMarket } = require('./create-market-token');
const { transferOwnershipPercentage } = require('./transfer-ownership');
const { Client, AccountBalanceQuery, PrivateKey, TokenInfoQuery } = require('@hashgraph/sdk');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Hedera client for balance queries
const client = Client.forTestnet();
const operatorId = process.env.MY_ACCOUNT_ID;
const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
client.setOperator(operatorId, operatorKey);

// POST /api/create - Create token and transfer to market account
app.post('/api/create', async (req, res) => {
  console.log("Create token request received:", req.body);
  try {
    const { name, symbol, marketAccountId, marketPrivateKey, nftTokenId, nftSerialNumber } = req.body;
    
    // Validate required fields
    if (!name || !symbol || !marketAccountId || !marketPrivateKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, symbol, marketAccountId, and marketPrivateKey are required' 
      });
    }

    // Use createTokenForMarket to create the token and transfer to market account
    const result = await createTokenForMarket(
      name, 
      symbol, 
      marketAccountId,
      marketPrivateKey,
      nftTokenId,
      nftSerialNumber
    );
    
    // Verify the market account actually has the tokens
    const marketBalance = await new AccountBalanceQuery()
      .setAccountId(marketAccountId)
      .execute(client);
      
    const marketShares = marketBalance.tokens._map.get(result.tokenId.toString());
    
    if (!marketShares || marketShares.toNumber() === 0) {
      return res.status(400).json({
        success: false,
        message: 'Token created but market account does not have any tokens. Check association and transfer steps.'
      });
    }
    
    return res.status(201).json({
      success: true,
      message: 'Fractional token created successfully',
      data: {
        tokenId: result.tokenId,
        tokenName: result.tokenName,
        symbol: result.symbol,
        totalShares: result.totalShares,
        marketAccount: result.marketAccount,
        marketShares: marketShares.toNumber()
      }
    });
  } catch (error) {
    console.error('Error creating token:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to create token: ${error.message}`
    });
  }
});

// POST /api/share - Share fractional ownership
app.post('/api/share', async (req, res) => {
  console.log("Share token request received:", req.body);
  try {
    const { tokenId, recipientId, percentageToShare, marketAccountId, marketPrivateKey } = req.body;
    
    // Validate required fields
    if (!tokenId || !recipientId || !percentageToShare || !marketAccountId || !marketPrivateKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token ID, recipient ID, percentage, market account ID and market private key are required' 
      });
    }

    // First verify the token exists
    try {
      const tokenInfo = await new TokenInfoQuery()
        .setTokenId(tokenId)
        .execute(client);
      console.log(`Token verified: ${tokenInfo.name} (${tokenInfo.symbol})`);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: `Token ${tokenId} not found or not accessible: ${error.message}`
      });
    }
    
    // Check if market has tokens first
    const marketBalanceCheck = await new AccountBalanceQuery()
      .setAccountId(marketAccountId)
      .execute(client);
      
    const marketShares = marketBalanceCheck.tokens._map.get(tokenId.toString());
    
    if (!marketShares || marketShares.toNumber() === 0) {
      return res.status(400).json({
        success: false,
        message: `Market account ${marketAccountId} does not have any ${tokenId} tokens to transfer`
      });
    }
    
    console.log(`Market currently has ${marketShares.toNumber()} shares`);
    
    // Transfer ownership percentage
    const result = await transferOwnershipPercentage(
      tokenId,
      recipientId,
      percentageToShare,
      marketAccountId,
      marketPrivateKey
    );
    
    return res.json({
      success: true,
      message: 'Ownership shared successfully',
      data: {
        sender: {
          accountId: result.market.accountId,
          shares: parseInt(result.market.shares.toString()),
          percentage: result.market.percentage
        },
        recipient: {
          accountId: result.recipient.accountId,
          shares: parseInt(result.recipient.shares.toString()),
          percentage: result.recipient.percentage
        },
        transactionId: result.transactionId
      }
    });
  } catch (error) {
    console.error('Error sharing ownership:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to share ownership: ${error.message}`
    });
  }
});

// GET /api/check - Check token ownership distribution
app.get('/api/check', async (req, res) => {
  try {
    const { tokenId, marketAccountId } = req.query;
    
    if (!tokenId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token ID is required' 
      });
    }

    // Market account is required to check market ownership
    if (!marketAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Market account ID is required to check ownership'
      });
    }
    
    // First verify the token exists
    try {
      await new TokenInfoQuery()
        .setTokenId(tokenId)
        .execute(client);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: `Token ${tokenId} not found or not accessible: ${error.message}`
      });
    }
    
    // Get market account balance
    const marketBalance = await new AccountBalanceQuery()
      .setAccountId(marketAccountId)
      .execute(client);
      
    const marketShares = marketBalance.tokens._map.get(tokenId.toString()) || 0;
    const totalShares = 10000; // Default total shares is 10,000
    
    // Calculate percentage
    const marketSharesNum = marketShares instanceof Object ? parseInt(marketShares.toString()) : 0;
    const marketPercentage = (marketSharesNum / totalShares) * 100;
    
    // In a real implementation, you would query all token holders from your database
    // or find a way to query all accounts that hold this token on Hedera
    return res.json({
      success: true,
      message: 'Ownership distribution retrieved successfully',
      data: {
        fractionalTokenId: tokenId,
        totalShares: totalShares,
        ownershipDistribution: [
          {
            accountId: marketAccountId,
            shares: marketSharesNum,
            percentage: marketPercentage
          }
          // Additional token holders would be listed here in a full implementation
        ]
      }
    });
  } catch (error) {
    console.error('Error checking ownership:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to check ownership: ${error.message}`
    });
  }
});

// Command-line interface for testing
if (require.main === module) {
  // Check if we're running in CLI mode
  if (process.argv.length > 2) {
    const command = process.argv[2];
    
    if (command === "create-token") {
      if (process.argv.length < 6) {
        console.error("Usage: node fractional-ownership-manager.js create-token <name> <symbol> <marketAccountId> <marketPrivateKey> [nftTokenId] [nftSerialNumber]");
        process.exit(1);
      }
      
      const name = process.argv[3];
      const symbol = process.argv[4];
      const marketAccountId = process.argv[5];
      const marketPrivateKey = process.argv[6];
      const nftTokenId = process.argv[7];
      const nftSerialNumber = process.argv[8] ? parseInt(process.argv[8]) : null;
      
      createTokenForMarket(name, symbol, marketAccountId, marketPrivateKey, nftTokenId, nftSerialNumber)
        .then(result => console.log("Token created:", JSON.stringify(result, null, 2)))
        .catch(error => console.error("Error creating token:", error));
      
    } else if (command === "share-ownership") {
      if (process.argv.length < 7) {
        console.error("Usage: node fractional-ownership-manager.js share-ownership <tokenId> <recipientId> <percentageToShare> <marketAccountId> <marketPrivateKey>");
        process.exit(1);
      }
      
      const tokenId = process.argv[3];
      const recipientId = process.argv[4];
      const percentageToShare = parseFloat(process.argv[5]);
      const marketAccountId = process.argv[6];
      const marketPrivateKey = process.argv[7];
      
      console.log(`Sharing ${percentageToShare}% ownership of token ${tokenId} with ${recipientId}...`);
      console.log(`Using market account ${marketAccountId}`);
      
      transferOwnershipPercentage(tokenId, recipientId, percentageToShare, marketAccountId, marketPrivateKey)
        .then(result => console.log("Ownership shared:", JSON.stringify(result, null, 2)))
        .catch(error => console.error("Error sharing ownership:", error));
      
    } else {
      console.error(`Unknown command: ${command}`);
      console.error("Available commands: create-token, share-ownership");
      process.exit(1);
    }
  } 
  // If no CLI arguments, start the server
  else {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Fractional NFT API server running on port ${PORT}`);
      console.log(`Available endpoints:`);
      console.log(`- POST /api/create - Create fractional token`);
      console.log(`- POST /api/share - Share fractional ownership`);
      console.log(`- GET /api/check - Check token ownership distribution`);
    });
  }
}

module.exports = app;