import { BotPersonality, GameAction, GameState, HandRank, Player } from '../types/poker';
import { evaluate7Cards } from './evaluator';

/**
 * 带性格参数的德州扑克 AI 决策引擎
 */
export function getBotAction(gameState: GameState, botPlayer: Player): GameAction {
  const personality: BotPersonality = botPlayer.botPersonality || 'TAG';
  const callAmount = Math.max(0, gameState.currentBet - botPlayer.currentBet);
  const { stage, communityCards, totalPot, minRaise } = gameState;
  const raiseBlocked = (gameState.cannotRaiseIds || []).includes(botPlayer.id);
  const canRaise = !raiseBlocked && botPlayer.chips > callAmount;

  const profile = {
    LOOSE: { preRaiseProb: 0.2, preCallLimitBB: 6, postAggro: 0.25, bluffProb: 0.04, foldThreshold: 0.75 },
    TAG:   { preRaiseProb: 0.6, preCallLimitBB: 3, postAggro: 0.65, bluffProb: 0.06, foldThreshold: 0.5 },
    LAG:   { preRaiseProb: 0.85, preCallLimitBB: 5, postAggro: 0.85, bluffProb: 0.18, foldThreshold: 0.7 },
  }[personality];

  if (stage === 'PREFLOP') {
    const c1 = botPlayer.holeCards[0];
    const c2 = botPlayer.holeCards[1];
    if (!c1 || !c2) return { type: 'FOLD', playerId: botPlayer.id };

    const isPair = c1.rank === c2.rank;
    const isSuited = c1.suit === c2.suit;
    const maxRank = Math.max(c1.rank, c2.rank);
    const minRank = Math.min(c1.rank, c2.rank);
    const isConnected = Math.abs(maxRank - minRank) <= 2;

    // 强起手牌：AA-TT, AK, AQ
    if ((isPair && maxRank >= 10) || (maxRank === 14 && minRank >= 12)) {
      if (canRaise && Math.random() < profile.preRaiseProb && botPlayer.chips + botPlayer.currentBet >= gameState.currentBet + minRaise) {
        const target = Math.min(
          botPlayer.chips + botPlayer.currentBet,
          gameState.currentBet + minRaise * (personality === 'LAG' ? 3 : 2)
        );
        return { type: 'RAISE', amount: target, playerId: botPlayer.id };
      }
      return callAmount >= botPlayer.chips
        ? { type: 'ALL_IN', playerId: botPlayer.id }
        : { type: callAmount === 0 ? 'CHECK' : 'CALL', playerId: botPlayer.id };
    }

    // 中等或投机牌
    if (
      isPair ||
      (isSuited && (maxRank >= 9 || isConnected)) ||
      (maxRank >= 11 && minRank >= 10) ||
      (personality === 'LOOSE' && maxRank >= 10)
    ) {
      if (callAmount === 0) {
        if (canRaise && personality === 'LAG' && Math.random() < 0.35 && botPlayer.chips + botPlayer.currentBet >= gameState.currentBet + minRaise) {
          return {
            type: 'RAISE',
            amount: Math.min(botPlayer.chips + botPlayer.currentBet, gameState.currentBet + minRaise * 2),
            playerId: botPlayer.id,
          };
        }
        return { type: 'CHECK', playerId: botPlayer.id };
      }
      if (callAmount <= gameState.bigBlind * profile.preCallLimitBB && callAmount <= botPlayer.chips) {
        return { type: 'CALL', playerId: botPlayer.id };
      }
    }

    if (callAmount === 0) {
      return { type: 'CHECK', playerId: botPlayer.id };
    }
    return { type: 'FOLD', playerId: botPlayer.id };
  }

  const evaluation = evaluate7Cards(botPlayer.holeCards, communityCards);
  const handRank = evaluation.rank;

  // 强成牌：三条以上
  if (handRank >= HandRank.THREE_OF_A_KIND) {
    if (canRaise && Math.random() < profile.postAggro && botPlayer.chips + botPlayer.currentBet >= gameState.currentBet + minRaise) {
      const raiseSize = Math.max(minRaise, Math.floor(totalPot * (personality === 'LAG' ? 0.75 : 0.5)));
      return {
        type: 'RAISE',
        amount: Math.min(botPlayer.chips + botPlayer.currentBet, gameState.currentBet + raiseSize),
        playerId: botPlayer.id,
      };
    }
    return callAmount === 0
      ? { type: 'CHECK', playerId: botPlayer.id }
      : callAmount >= botPlayer.chips
      ? { type: 'ALL_IN', playerId: botPlayer.id }
      : { type: 'CALL', playerId: botPlayer.id };
  }

  // 中等成牌：两对、一对
  if (handRank === HandRank.TWO_PAIR || handRank === HandRank.ONE_PAIR) {
    if (callAmount === 0) {
      if (canRaise && Math.random() < profile.postAggro * 0.6 && botPlayer.chips >= minRaise) {
        return {
          type: 'BET',
          amount: Math.min(botPlayer.chips, Math.max(minRaise, Math.floor(totalPot * 0.35))),
          playerId: botPlayer.id,
        };
      }
      return { type: 'CHECK', playerId: botPlayer.id };
    }
    if (callAmount <= Math.max(gameState.bigBlind * 2, totalPot * profile.foldThreshold) && callAmount <= botPlayer.chips) {
      return { type: 'CALL', playerId: botPlayer.id };
    }
    return { type: 'FOLD', playerId: botPlayer.id };
  }

  // 高牌
  if (callAmount === 0) {
    if (canRaise && Math.random() < profile.bluffProb && botPlayer.chips >= minRaise) {
      return { type: 'BET', amount: Math.min(botPlayer.chips, minRaise), playerId: botPlayer.id };
    }
    return { type: 'CHECK', playerId: botPlayer.id };
  }

  if (personality === 'LOOSE' && callAmount <= gameState.bigBlind && callAmount <= botPlayer.chips) {
    return { type: 'CALL', playerId: botPlayer.id };
  }

  return { type: 'FOLD', playerId: botPlayer.id };
}
