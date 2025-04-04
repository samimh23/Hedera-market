const { 
    Client, 
    PrivateKey, 
    TokenCreateTransaction, 
    TokenType,
    TokenSupplyType,
    TokenMintTransaction,
    TokenAssociateTransaction,
    TokenInfoQuery,
    TransferTransaction,
    Hbar
  } = require("@hashgraph/sdk");
  require("dotenv").config();
  
  async function createFractionalShares(nftTokenId, nftSerialNumber) {
    // Get operator from environment variables
    const operatorId = process.env.MY_ACCOUNT_ID;
    const operatorKey = PrivateKey.fromStringECDSA(process.env.MY_PRIVATE_KEY);
    
    // Initialize client
    const client = Client.forTestnet();
    client.setOperator(operatorId, operatorKey);
    
    console.log("Creating fractional ownership token...");
    
    // Total shares representing 100% ownership
    // Using 10000 for precision (allowing ownership down to 0.01%)
    const TOTAL_SHARES = 10000;
    
    // Create fractional ownership token
    const sharesTotalSupply = TOTAL_SHARES;
    
    const fractionalTokenTx = await new TokenCreateTransaction()
      .setTokenName(`Shares of NFT ${nftTokenId} #${nftSerialNumber}`)
      .setTokenSymbol("SHARE")
      .setTokenType(TokenType.FungibleCommon) // Fungible token for divisible shares
      .setDecimals(2)  // 2 decimal places for precise ownership percentage
      .setInitialSupply(sharesTotalSupply) // All shares initially owned by creator
      .setTreasuryAccountId(operatorId) // Creator holds all shares initially
      .setAdminKey(operatorKey)
      .setSupplyKey(operatorKey)
      .setFeeScheduleKey(operatorKey)
      .setFreezeKey(operatorKey)
      .freezeWith(client);
      
    // Sign and submit the transaction
    const fractionalTokenTxSign = await fractionalTokenTx.sign(operatorKey);
    const fractionalTokenSubmit = await fractionalTokenTxSign.execute(client);
    const fractionalTokenRx = await fractionalTokenSubmit.getReceipt(client);
    const fractionalTokenId = fractionalTokenRx.tokenId;
    
    console.log(`Fractional ownership token created with ID: ${fractionalTokenId}`);
    console.log(`Initial owner (${operatorId}) has 100% ownership (${TOTAL_SHARES} shares)`);
    
    return { 
      fractionalTokenId, 
      totalShares: TOTAL_SHARES 
    };
  }
  
  module.exports = { createFractionalShares };
  
  // If running directly with NFT details as command line arguments
  if (require.main === module) {
    if (process.argv.length < 4) {
      console.error("Usage: node create-fractional-shares.js <nftTokenId> <nftSerialNumber>");
      process.exit(1);
    }
    
    const nftTokenId = process.argv[2];
    const nftSerialNumber = parseInt(process.argv[3]);
    
    createFractionalShares(nftTokenId, nftSerialNumber)
      .then(result => console.log("Fractional shares creation completed:", result))
      .catch(error => console.error("Error creating fractional shares:", error));
  }