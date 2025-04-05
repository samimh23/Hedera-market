const { 
  Client, 
  PrivateKey,
  TokenAssociateTransaction,
  TransferTransaction,
  AccountBalanceQuery,
  TokenInfoQuery,
  AccountInfoQuery
} = require("@hashgraph/sdk");
require("dotenv").config();

// Helper function to check if a token is associated with an account
async function isTokenAssociated(accountId, tokenId, client) {
  try {
    const accountBalance = await new AccountBalanceQuery()
      .setAccountId(accountId)
      .execute(client);
      
    // Check if the token exists in the account's token balances
    const tokenBalance = accountBalance.tokens._map.get(tokenId.toString());
    return tokenBalance !== undefined;
  } catch (error) {
    console.error(`Error checking token association: ${error.message}`);
    return false;
  }
}

// Function to associate a token with an account
async function associateTokenWithAccount(accountId, tokenId, privateKey) {
  try {
    console.log(`Attempting to associate token ${tokenId} with account ${accountId}...`);
    
    // Create account client with provided credentials
    const accountPrivateKey = PrivateKey.fromString(privateKey);
    const accountClient = Client.forTestnet();
    accountClient.setOperator(accountId, accountPrivateKey);
    
    // Create and execute the association transaction
    const associateTx = new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tokenId]);
      
    const associateResponse = await associateTx.execute(accountClient);
    const associateReceipt = await associateResponse.getReceipt(accountClient);
    
    console.log(`Token association status: ${associateReceipt.status.toString()}`);
    return true;
  } catch (error) {
    if (error.message.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
      console.log("Token already associated with the account.");
      return true;
    }
    console.error(`Error associating token: ${error.message}`);
    return false;
  }
}

async function transferOwnershipPercentage(tokenId, recipientId, percentageToShare, marketAccountId, marketPrivateKeyString, recipientPrivateKey = null) {
  try {
    // Create client with operator credentials first for queries
    const operatorId = process.env.MY_ACCOUNT_ID;
    const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
    
    const client = Client.forTestnet();
    client.setOperator(operatorId, operatorKey);
    console.log("Client initialized with operator credentials");
    
    // Log the input parameters
    console.log(`Processing share request: ${percentageToShare}% of token ${tokenId} from ${marketAccountId} to ${recipientId}`);
    
    // Create market client and key
    const marketPrivateKey = PrivateKey.fromString(marketPrivateKeyString);
    const marketClient = Client.forTestnet();
    marketClient.setOperator(marketAccountId, marketPrivateKey);
    
    console.log(`Using account ${marketAccountId} as sender`);
    console.log(`Token ID: ${tokenId}`);
    console.log(`Recipient ID: ${recipientId}`);
    console.log(`Percentage to share: ${percentageToShare}%`);
    console.log(`Recipient private key provided: ${recipientPrivateKey ? 'Yes' : 'No'}`);
    
    // Get token info to verify token exists
    console.log("Getting token info...");
    const tokenInfo = await new TokenInfoQuery()
      .setTokenId(tokenId)
      .execute(client);
    
    console.log(`Token info retrieved: ${tokenInfo.name}, ${tokenInfo.symbol}`);
    
    const totalShares = 10000; // Same as in create-market-token.js
    
    // Check market account balance first
    console.log(`Verifying market account ${marketAccountId} has token ${tokenId}...`);
    const marketBalanceCheck = await new AccountBalanceQuery()
      .setAccountId(marketAccountId)
      .execute(client);
      
    const marketCurrentShares = marketBalanceCheck.tokens._map.get(tokenId.toString());
    
    if (!marketCurrentShares) {
      throw new Error(`Market account ${marketAccountId} does not have any tokens to transfer. The token might not exist or might not be associated with the market account.`);
    }
    
    const marketShares = marketCurrentShares.toNumber();
    console.log(`Market account has ${marketShares} shares`);
    
    // Calculate shares to transfer based on percentage
    const sharesToTransfer = Math.floor((percentageToShare / 100) * totalShares);
    
    if (marketShares < sharesToTransfer) {
      throw new Error(`Insufficient balance: Market has ${marketShares} shares, but trying to transfer ${sharesToTransfer} shares`);
    }
    
    // Check if the token is already associated with the recipient
    console.log(`Checking if token ${tokenId} is already associated with account ${recipientId}...`);
    const isAssociated = await isTokenAssociated(recipientId, tokenId, client);
    
    // If token is not associated and recipient private key was provided, associate it
    if (!isAssociated) {
      console.log(`Token not associated with recipient account.`);
      
      if (recipientPrivateKey) {
        console.log(`Recipient private key provided. Attempting to associate token automatically.`);
        const associationSuccess = await associateTokenWithAccount(recipientId, tokenId, recipientPrivateKey);
        
        if (!associationSuccess) {
          throw new Error(`Failed to automatically associate token ${tokenId} with account ${recipientId}. Please check the recipient's private key and try again.`);
        }
        console.log(`Token successfully associated with recipient account.`);
      } else {
        throw new Error(`Token ${tokenId} is not associated with recipient account ${recipientId}. Please provide the recipient's private key in the 'recipientPrivateKey' field to automatically associate the token, or have the recipient use the /api/associate endpoint.`);
      }
    } else {
      console.log(`Token is already associated with recipient account ${recipientId}`);
    }
    
    // Now transfer the shares using the market account
    console.log(`Creating transfer transaction for ${sharesToTransfer} shares (${percentageToShare}%)...`);
    
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
      console.error(`Transfer error: ${error}`);
      
      // Check if this is a token association issue
      if (error.message.includes("TOKEN_NOT_ASSOCIATED_TO_ACCOUNT")) {
        throw new Error(`TOKEN_NOT_ASSOCIATED_TO_ACCOUNT: The recipient account ${recipientId} needs to be associated with token ${tokenId} before receiving shares. Please provide the recipient's private key to associate automatically, or have the recipient call the /api/associate endpoint.`);
      }
      
      throw error;
    }
  } catch (error) {
    console.error(`Error in transferOwnershipPercentage: ${error.message}`);
    console.error(`Stack trace: ${error.stack}`);
    throw error;
  }
}

module.exports = { transferOwnershipPercentage, isTokenAssociated, associateTokenWithAccount };

// If running directly
if (require.main === module) {
  if (process.argv.length < 6) {
    console.error("Usage: node transfer-ownership.js <tokenId> <recipientId> <percentageToShare> <marketAccountId> <marketPrivateKey> [recipientPrivateKey]");
    process.exit(1);
  }
  
  const tokenId = process.argv[2];
  const recipientId = process.argv[3];
  const percentageToShare = parseFloat(process.argv[4]);
  const marketAccountId = process.argv[5];
  const marketPrivateKey = process.argv[6];
  const recipientPrivateKey = process.argv[7] || null;
  
  transferOwnershipPercentage(tokenId, recipientId, percentageToShare, marketAccountId, marketPrivateKey, recipientPrivateKey)
    .then(result => console.log("\nOwnership transfer completed:", JSON.stringify(result, null, 2)))
    .catch(error => console.error("Error transferring ownership:", error));
}