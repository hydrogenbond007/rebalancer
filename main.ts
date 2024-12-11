import {
  LiquidityPoolKeys,
  Token,
  TokenAmount,
  MakeTransaction,
} from '@raydium-io/raydium-sdk-v2';

import Liquidity from "./liquidity/liquidity";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';


class RaydiumLiquidityRebalancer {
  private raydium!: Liquidity;
  private connection: Connection;
  private owner: Keypair;
  private poolId: string;
  
  // Initial target amounts
  private initialSolAmount: number;
  private initialTokenAmount: number;
  private tokenMint: PublicKey;

  constructor(
    connection: Connection, 
    owner: Keypair, 
    poolId: string, 
    tokenMint: PublicKey,
    initialSolAmount: number,
    initialTokenAmount: number
  ) {
    this.connection = connection;
    this.owner = owner;
    this.poolId = poolId;
    this.tokenMint = tokenMint;
    this.initialSolAmount = initialSolAmount;
    this.initialTokenAmount = initialTokenAmount;
  }

  async initialize(): Promise<void> {
    this.raydium = await Liquidity.load({
      connection: this.connection,
      owner: this.owner,
      disableLoadToken: false
    });
  }

  async checkPositionRange(): Promise<boolean> {
    // Fetch current pool information
    const poolInfo = await this.raydium.api.fetchPoolById({ 
      ids: this.poolId 
    });

    if (!poolInfo || poolInfo.length === 0) {
      throw new Error('Pool not found');
    }

    const pool = poolInfo[0];
    
    // Calculate current token amounts
    const currentSolAmount = pool.liquidity1Amount / LAMPORTS_PER_SOL;
    const currentTokenAmount = pool.liquidity2Amount;

    // Check if position is within 10% range
    return (
      Math.abs(currentSolAmount - this.initialSolAmount) / this.initialSolAmount <= 0.1 &&
      Math.abs(currentTokenAmount - this.initialTokenAmount) / this.initialTokenAmount <= 0.1
    );
  }

  async removeLiquidity(): Promise<{ solAmount: number, tokenAmount: number }> {
    try {
      const removeLiquidityParams = {
        poolId: this.poolId,
        amountIn: '100%', // Remove entire position
        wallet: this.owner
      };

      const { transaction } = await this.raydium.liquidity.removeLiquidity(removeLiquidityParams);
      
      // Sign and send transaction
      transaction.feePayer = this.owner.publicKey;
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.sign(this.owner);

      const txId = await this.connection.sendRawTransaction(transaction.serialize());
      await this.connection.confirmTransaction(txId);

      // Return removed amounts (simplified - actual implementation depends on SDK)
      return { 
        solAmount: this.initialSolAmount, 
        tokenAmount: this.initialTokenAmount 
      };
    } catch (error) {
      console.error('Error removing liquidity:', error);
      throw error;
    }
  }

  async swapTokens(
    swapAmount: number, 
    direction: 'solToToken' | 'tokenToSol'
  ): Promise<number> {
    try {
      const swapParams = {
        poolId: this.poolId,
        inputMint: direction === 'solToToken' 
          ? PublicKey.default // SOL mint 
          : this.tokenMint,
        outputMint: direction === 'solToToken' 
          ? this.tokenMint 
          : PublicKey.default,
        inputAmount: swapAmount,
        wallet: this.owner
      };

      const { transaction, minAmountOut } = await this.raydium.swap.swap(swapParams);
      
      // Sign and send transaction
      transaction.feePayer = this.owner.publicKey;
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.sign(this.owner);

      const txId = await this.connection.sendRawTransaction(transaction.serialize());
      await this.connection.confirmTransaction(txId);

      return Number(minAmountOut);
    } catch (error) {
      console.error('Error swapping tokens:', error);
      throw error;
    }
  }

  async addLiquidity(solAmount: number, tokenAmount: number): Promise<void> {
    try {
      const addLiquidityParams = {
        poolId: this.poolId,
        amount1: solAmount,
        amount2: tokenAmount,
        wallet: this.owner
      };

      const { transaction } = await this.raydium.liquidity.addLiquidity(addLiquidityParams);
      
      // Sign and send transaction
      transaction.feePayer = this.owner.publicKey;
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.sign(this.owner);

      const txId = await this.connection.sendRawTransaction(transaction.serialize());
      await this.connection.confirmTransaction(txId);
    } catch (error) {
      console.error('Error adding liquidity:', error);
      throw error;
    }
  }

  async rebalance(): Promise<void> {
    // Check if rebalancing is necessary
    const isInRange = await this.checkPositionRange();
    if (isInRange) {
      console.log('Position is within range. No rebalancing needed.');
      return;
    }

    // Remove current liquidity
    const { solAmount, tokenAmount } = await this.removeLiquidity();

    // Determine rebalancing strategy
    const totalValue = solAmount + tokenAmount;
    const targetSolAmount = this.initialSolAmount;
    const targetTokenAmount = this.initialTokenAmount;

    if (solAmount > targetSolAmount) {
      // Swap excess SOL to tokens
      const swapAmount = solAmount - targetSolAmount;
      const receivedTokens = await this.swapTokens(swapAmount, 'solToToken');
      
      // Add liquidity with rebalanced amounts
      await this.addLiquidity(
        targetSolAmount, 
        receivedTokens + tokenAmount
      );
    } else {
      // Swap excess tokens to SOL
      const swapAmount = tokenAmount - targetTokenAmount;
      const receivedSol = await this.swapTokens(swapAmount, 'tokenToSol');
      
      // Add liquidity with rebalanced amounts
      await this.addLiquidity(
        receivedSol + solAmount, 
        targetTokenAmount
      );
    }

    console.log('Liquidity rebalanced successfully');
  }
}

// Example usage
async function main() {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  
  // Replace with actual secret key
  const secretKey = new Uint8Array([/* your wallet secret key bytes */]); 
  const owner = Keypair.fromSecretKey(secretKey);
  
  const poolId = 'YOUR_RAYDIUM_POOL_ID';
  const tokenMint = new PublicKey('TOKEN_MINT_ADDRESS');

  const rebalancer = new RaydiumLiquidityRebalancer(
    connection,
    owner,
    poolId,
    tokenMint,
    5,  // Initial SOL amount
    5   // Initial token amount
  );

  await rebalancer.initialize();
  await rebalancer.rebalance();
}

// Run it
main().catch(console.error);

export default RaydiumLiquidityRebalancer;