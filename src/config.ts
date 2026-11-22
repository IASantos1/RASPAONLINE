export const PRICES_EUR = [1, 2, 4, 6, 8, 10, 15, 20, 50] as const;
export const ISSUE_SIZE = 1_000;
export const BATCH_SIZE = 100;
export const TARGET_RTP_PERCENT = 40;

export type GameModel = "sorte" | "cofre" | "semana" | "fortuna";

export interface PrizeTier {
  multiplier: number;
  ticketCount: number;
  symbolId: string;
}

export interface ModelConfig {
  name: string;
  rows: number;
  columns: number;
  symbols: readonly { id: string; label: string; emoji: string }[];
  tiers: readonly PrizeTier[];
}

const symbols = [
  { id: "trevo", label: "Trevo", emoji: "🍀" },
  { id: "estrela", label: "Estrela", emoji: "⭐" },
  { id: "ferradura", label: "Ferradura", emoji: "🧲" },
  { id: "sino", label: "Sino", emoji: "🔔" },
  { id: "moeda", label: "Moeda", emoji: "🪙" },
  { id: "diamante", label: "Diamante", emoji: "💎" },
  { id: "coroa", label: "Coroa", emoji: "👑" },
  { id: "rubi", label: "Rubi", emoji: "🔴" },
  { id: "barra-ouro", label: "Barra de ouro", emoji: "🟨" },
  { id: "chave", label: "Chave", emoji: "🗝️" },
  { id: "cofre", label: "Cofre", emoji: "🔐" },
  { id: "saco-ouro", label: "Saco de ouro", emoji: "💰" },
  { id: "perola", label: "Pérola", emoji: "🦪" }
] as const;

export const MODELS: Record<GameModel, ModelConfig> = {
  sorte: {
    name: "Raspadinha da Sorte",
    rows: 2,
    columns: 3,
    symbols,
    tiers: [
      { multiplier: 1, ticketCount: 200, symbolId: "trevo" },
      { multiplier: 2, ticketCount: 50, symbolId: "estrela" },
      { multiplier: 5, ticketCount: 10, symbolId: "ferradura" },
      { multiplier: 10, ticketCount: 3, symbolId: "sino" },
      { multiplier: 20, ticketCount: 1, symbolId: "moeda" }
    ]
  },
  cofre: {
    name: "Cofre Cheio",
    rows: 3,
    columns: 3,
    symbols,
    tiers: [
      { multiplier: 1, ticketCount: 150, symbolId: "chave" },
      { multiplier: 2, ticketCount: 40, symbolId: "cofre" },
      { multiplier: 10, ticketCount: 8, symbolId: "barra-ouro" },
      { multiplier: 20, ticketCount: 2, symbolId: "diamante" },
      { multiplier: 25, ticketCount: 2, symbolId: "coroa" }
    ]
  },
  semana: {
    name: "Raspadinha da Semana",
    rows: 3,
    columns: 3,
    symbols,
    tiers: [
      { multiplier: 1, ticketCount: 220, symbolId: "estrela" },
      { multiplier: 2, ticketCount: 20, symbolId: "moeda" },
      { multiplier: 5, ticketCount: 8, symbolId: "rubi" },
      { multiplier: 20, ticketCount: 1, symbolId: "coroa" },
      { multiplier: 80, ticketCount: 1, symbolId: "diamante" }
    ]
  },
  fortuna: {
    name: "Fortuna Dourada",
    rows: 4,
    columns: 4,
    symbols,
    tiers: [
      { multiplier: 1, ticketCount: 60, symbolId: "moeda" },
      { multiplier: 2, ticketCount: 20, symbolId: "rubi" },
      { multiplier: 10, ticketCount: 10, symbolId: "barra-ouro" },
      { multiplier: 20, ticketCount: 5, symbolId: "diamante" },
      { multiplier: 100, ticketCount: 1, symbolId: "coroa" }
    ]
  }
};

export function getModelConfig(model: GameModel): ModelConfig {
  const config = MODELS[model];
  if (!config) throw new Error(`Modelo desconhecido: ${model}`);
  return config;
}

export function validatePrice(priceEur: number): void {
  if (!(PRICES_EUR as readonly number[]).includes(priceEur)) {
    throw new Error(`Preço não permitido: €${priceEur}`);
  }
}