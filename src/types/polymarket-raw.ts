export interface PolymarketMarketRaw {
  id: string;
  question: string;
  description?: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  volume24hr: string;
  liquidity: string;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  closed: boolean;
  archived: boolean;
  active: boolean;
  questionID?: string;
  conditionId: string;
  slug?: string;
  category?: string;
  groupItemTitle?: string;
  resolution?: string;
  resolutionSource?: string;
  tags?: string[];
  clobTokenIds?: string[];
}

export interface PolymarketMarketsResponse {
  data: PolymarketMarketRaw[];
  next_cursor?: string;
}
