const { 
  Client, 
  PrivateKey,
  TokenAssociateTransaction,
  TransferTransaction,
  AccountBalanceQuery,
  TokenInfoQuery
} = require("@hashgraph/sdk");
require("dotenv").config();

async function transferOwnershipPercentage(tokenId, recipientId, percentageToShare, marketAccountId, marketPrivateKeyString) {
  try {
    // Create client with operator credentials first for queries
    const operatorId = process.env.MY_ACCOUNT_ID;
    const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
    
    const client = Client.forTestnet();
    client.setOperator(operatorId, operatorKey);
    console.log("Client initialized with operator credentials");
    
    // Log the input parameters
    console.log(`Processing share request: ${percentageToShare}% of token ${tokenId} from ${marketAccountId} to ${recipientId}`);
    
    // Create market client
    const marketPrivateKey = PrivateKey.fromString(marketPrivateKeyString);
    
    console.log(`Using account ${marketAccountId} as sender`);
    console.log(`Token ID: ${tokenId}`);
    console.log(`Recipient ID: ${recipientId}`);
    console.log(`Percentage to share: ${percentageToShare}%`);
    
    // Get token info to verify token exists
    console.log("Getting token info...");
    const tokenInfo = await new TokenInfoQuery()
      .setTokenId(tokenId)
      .execute(client);
    
    console.log(`Token info retrieved: ${tokenInfo.name}, ${tokenInfo.symbol}`);
    const totalShares = 10000; // Same as in create-fractional-shares.js
    
    // Check market account balance FIRST to ensure it has tokens before proceeding
    console.log(`Verifying market account ${marketAccountId} has token ${tokenId} associated...`);
    const marketBalanceCheck = await new AccountBalanceQuery()
      .setAccountId(marketAccountId)
      .execute(client);
      
    const marketCurrentShares = marketBalanceCheck.tokens._map.get(tokenId.toString());
    
    if (!marketCurrentShares) {
      console.log(`Market account may need token association: Token not found in market account balance`);
      
      // Try to associate token with market account
      try {
        console.log(`Executing market association transaction...`);
        const marketAssociateTx = new TokenAssociateTransaction()
          .setAccountId(marketAccountId)
          .setTokenIds([tokenId]);
        
        // Switch to market client for this operation
        const marketClient = Client.forTestnet();
        marketClient.setOperator(marketAccountId, marketPrivateKey);
        
        const marketAssociateResponse = await marketAssociateTx.execute(marketClient);
        const marketAssociateReceipt = await marketAssociateResponse.getReceipt(marketClient);
        console.log(`Market token association status: ${marketAssociateReceipt.status}`);
        
        // Switch back to operator client
        client.setOperator(operatorId, operatorKey);
      } catch (error) {
        console.log(`Market association attempt failed: ${error.message}`);
        // Continue to see if tokens can still be transferred
      }
      
      // Check the balance again
      const marketBalanceRecheck = await new AccountBalanceQuery()
        .setAccountId(marketAccountId)
        .execute(client);
        
      const marketSharesRecheck = marketBalanceRecheck.tokens._map.get(tokenId.toString());
      
      if (!marketSharesRecheck || marketSharesRecheck.toNumber() === 0) {
        throw new Error(`Market account ${marketAccountId} does not have any tokens to transfer. The token might not have been properly created and transferred to the market account.`);
      }
    }
    
    // Calculate shares to transfer based on percentage
    const marketShares = marketCurrentShares ? marketCurrentShares.toNumber() : 0;
    console.log(`Market account has ${marketShares} shares`);
    
    const sharesToTransfer = Math.floor((percentageToShare / 100) * totalShares);
    
    if (marketShares < sharesToTransfer) {
      throw new Error(`Insufficient balance: Market has ${marketShares} shares, but trying to transfer ${sharesToTransfer} shares`);
    }
    
    console.log(`Transferring ${percentageToShare}% ownership (${sharesToTransfer} shares) from ${marketAccountId} to ${recipientId}...`);
    
    // First, try to associate the token with the recipient
    try {
      console.log(`Associating token ${tokenId} with account ${recipientId}...`);
      const associateTx = new TokenAssociateTransaction()
        .setAccountId(recipientId)
        .setTokenIds([tokenId]);
      
      const associateResponse = await associateTx.execute(client);
      
      try {
        console.log("Getting association receipt...");
        const associateReceipt = await associateResponse.getReceipt(client);
        console.log(`Token association status: ${associateReceipt.status}`);
      } catch (error) {
        console.log(`Could not get association receipt, but continuing: ${error.message}`);
      }
    } catch (error) {
      console.log(`Association might already exist or failed: ${error.message}`);
      // Continue with the transfer attempt
    }
    
    // Now transfer the shares using the market account
    console.log(`Creating transfer transaction...`);
    
    // Set up a client specifically for the market account
    const marketClient = Client.forTestnet();
    marketClient.setOperator(marketAccountId, marketPrivateKey);
    
    const transferTx = new TransferTransaction()
      .addTokenTransfer(tokenId, marketAccountId, -sharesToTransfer)
      .addTokenTransfer(tokenId, recipientId, sharesToTransfer);
    
    console.log(`Executing transfer transaction as ${marketAccountId}...`);
    try {
      const transferSubmit = await transferTx.execute(marketClient);
      
      console.log(`Getting transfer receipt...`);
      const transferRx = await transferSubmit.getReceipt(marketClient);
      
      console.log(`Ownership transfer status: ${transferRx.status.toString()}`);
      
      // Check balances after transfer using the operator client
      console.log("Checking balances after transfer...");
      const afterMarketBalance = await new AccountBalanceQuery()
        .setAccountId(marketAccountId)
        .execute(client);
        
      const afterRecipientBalance = await new AccountBalanceQuery()
        .setAccountId(recipientId)
        .execute(client);
        
      const afterMarketShares = afterMarketBalance.tokens._map.get(tokenId.toString()) || 0;
      const afterRecipientShares = afterRecipientBalance.tokens._map.get(tokenId.toString()) || 0;
      
      const afterMarketPercentage = (afterMarketShares.toNumber() / totalShares) * 100;
      const afterRecipientPercentage = (afterRecipientShares.toNumber() / totalShares) * 100;
      
      console.log(`\nNew ownership distribution:`);
      console.log(`${marketAccountId}: ${afterMarketShares.toNumber()} shares (${afterMarketPercentage.toFixed(2)}%)`);
      console.log(`${recipientId}: ${afterRecipientShares.toNumber()} shares (${afterRecipientPercentage.toFixed(2)}%)`);
      
      return {
        status: transferRx.status.toString(),
        market: {
          accountId: marketAccountId,
          shares: afterMarketShares,
          percentage: afterMarketPercentage
        },
        recipient: {
          accountId: recipientId,
          shares: afterRecipientShares,
          percentage: afterRecipientPercentage
        },
        transactionId: transferSubmit.transactionId.toString()
      };
    } catch (error) {
      console.log(`Transfer error: ${error}`);
      throw error;
    }
  } catch (error) {
    console.error(`Error in transferOwnershipPercentage: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);
    throw error;
  }
}

module.exports = { transferOwnershipPercentage };

// If running directly
if (require.main === module) {
  if (process.argv.length < 6) {
    console.error("Usage: node transfer-ownership.js <tokenId> <recipientId> <percentageToShare> <marketAccountId> <marketPrivateKey>");
    process.exit(1);
  }
  
  const tokenId = process.argv[2];
  const recipientId = process.argv[3];
  const percentageToShare = parseFloat(process.argv[4]);
  const marketAccountId = process.argv[5];
  const marketPrivateKey = process.argv[6];
  
  transferOwnershipPercentage(tokenId, recipientId, percentageToShare, marketAccountId, marketPrivateKey)
    .then(result => console.log("\nOwnership transfer completed:", JSON.stringify(result, null, 2)))
    .catch(error => console.error("Error transferring ownership:", error));
}