const {
    Client,
    PrivateKey,
    TokenCreateTransaction,
    TokenType,
    TokenSupplyType,
    TransferTransaction,
    AccountBalanceQuery,
    TokenAssociateTransaction
  } = require('@hashgraph/sdk');
  require('dotenv').config();
  
  async function createTokenForMarket(name, symbol, marketAccount, marketPrivateKeyString, nftTokenId = null, nftSerialNumber = null) {
    // Initialize client with operator credentials
    const client = Client.forTestnet();
    const operatorId = process.env.MY_ACCOUNT_ID;
    const operatorKey = PrivateKey.fromString(process.env.MY_PRIVATE_KEY);
    
    client.setOperator(operatorId, operatorKey);
    
    try {
      console.log(`Creating fractional ownership token for market account ${marketAccount}...`);
      
      // Parse the market private key
      const marketKey = PrivateKey.fromString(marketPrivateKeyString);
      
      // Construct token name
      let tokenName = name;
      if (nftTokenId && nftSerialNumber) {
        tokenName = `Shares of NFT ${nftTokenId} #${nftSerialNumber}`;
      }
      
      // Create the token with operator as initial treasury
      const createTx = new TokenCreateTransaction()
        .setTokenName(tokenName)
        .setTokenSymbol(symbol)
        .setDecimals(0)
        .setInitialSupply(10000) // 10,000 shares representing 100%
        .setTreasuryAccountId(operatorId) // Operator starts as treasury
        .setAdminKey(operatorKey.publicKey)
        .setSupplyKey(operatorKey.publicKey)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(10000)
        .setAutoRenewAccountId(operatorId);
      
      console.log("Executing token create transaction...");
      const createResponse = await createTx.execute(client);
      
      console.log("Getting token creation receipt...");
      const receipt = await createResponse.getReceipt(client);
      
      const tokenId = receipt.tokenId;
      console.log(`Token created successfully! ID: ${tokenId}`);
      
      // Step 1: Associate token with market account
      console.log(`Associating token ${tokenId} with market account ${marketAccount}...`);
      
      const associateTx = new TokenAssociateTransaction()
        .setAccountId(marketAccount)
        .setTokenIds([tokenId]);
      
      // IMPORTANT - Try to sign the association with the market key
      // This is the key point - we need the market account's key to sign its associations
      console.log("Freezing association transaction...");
      const frozenAssociateTx = await associateTx.freezeWith(client);
      
      console.log("Signing association with market's key...");
      const signedAssociateTx = await frozenAssociateTx.sign(marketKey);
      
      console.log("Executing association transaction...");
      const associateResponse = await signedAssociateTx.execute(client);
      
      console.log("Getting association receipt...");
      const associateReceipt = await associateResponse.getReceipt(client);
      console.log(`Association status: ${associateReceipt.status}`);
      
      // Step 2: Now transfer tokens to market account
      console.log(`Transferring tokens to market account ${marketAccount}...`);
      
      const transferTx = new TransferTransaction()
        .addTokenTransfer(tokenId, operatorId, -10000) // Transfer all 10,000 shares
        .addTokenTransfer(tokenId, marketAccount, 10000);
      
      console.log("Executing transfer transaction...");
      const transferResponse = await transferTx.execute(client);
      
      console.log("Getting transfer receipt...");
      const transferReceipt = await transferResponse.getReceipt(client);
      
      console.log(`Transfer status: ${transferReceipt.status}`);
      
      // Verify final balances
      console.log("Checking final balances...");
      const operatorBalance = await new AccountBalanceQuery()
        .setAccountId(operatorId)
        .execute(client);
      
      const marketBalance = await new AccountBalanceQuery()
        .setAccountId(marketAccount)
        .execute(client);
      
      const operatorShares = operatorBalance.tokens._map.get(tokenId.toString()) || 0;
      const marketShares = marketBalance.tokens._map.get(tokenId.toString()) || 0;
      
      console.log(`Final distribution:`);
      console.log(`Operator (${operatorId}): ${operatorShares} shares (${(operatorShares / 10000) * 100}%)`);
      console.log(`Market (${marketAccount}): ${marketShares} shares (${(marketShares / 10000) * 100}%)`);
      
      return {
        tokenId: tokenId.toString(),
        tokenName: tokenName,
        symbol: symbol,
        totalShares: 10000,
        marketAccount: marketAccount,
        marketShares: marketShares
      };
    } catch (error) {
      console.error(`Error creating token for market: ${error.message}`);
      throw error;
    }
  }
  
  // If running directly
  if (require.main === module) {
    if (process.argv.length < 5) {
      console.error("Usage: node create-market-token.js <symbol> <marketAccount> <marketPrivateKey> [nftTokenId] [nftSerialNumber]");
      process.exit(1);
    }
    
    const symbol = process.argv[2];
    const marketAccount = process.argv[3];
    const marketPrivateKey = process.argv[4];
    const nftTokenId = process.argv.length > 5 ? process.argv[5] : null;
    const nftSerialNumber = process.argv.length > 6 ? parseInt(process.argv[6]) : null;
    
    let name = "Fractional Ownership Token";
    if (nftTokenId && nftSerialNumber) {
      name = `Shares of NFT ${nftTokenId} #${nftSerialNumber}`;
    }
    
    createTokenForMarket(name, symbol, marketAccount, marketPrivateKey, nftTokenId, nftSerialNumber)
      .then(result => console.log("\nToken creation completed:", JSON.stringify(result, null, 2)))
      .catch(error => console.error("Error:", error));
  }
  
  module.exports = { createTokenForMarket };