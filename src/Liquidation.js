const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');

class Liquidation {
  constructor() {
    this.liquidations = [];
    this.filePath = './src/liquidations/liquidations.json';
    this.wsUrl = 'wss://fstream.binance.com/ws/!forceOrder@arr';
    this.loadFromFile().then(() => {
      this.setupWebSocket();
      // Changed cleanup interval to run every 30 seconds instead of every minute
      setInterval(() => this.cleanupOldEvents(), 30000);
    });
  }

  async setupWebSocket(retryCount = 0) {
    const ws = new WebSocket(this.wsUrl);

    ws.on('open', () => {
      console.log('✅ Connected to Binance liquidation stream');
      retryCount = 0;
    });

    ws.on('message', async (data) => {
      try {
        const liquidation = JSON.parse(data).o;
        const quantity = parseFloat(liquidation.q);
        const price = parseFloat(liquidation.ap);

        const formatted = {
          symbol: liquidation.s,
          side: liquidation.S,
          type: liquidation.o,
          quantity,
          price,
          usdtValue: quantity * price,
          timestamp: new Date(liquidation.T),
        };

        this.liquidations.push(formatted);
        await this.saveToFile();
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket closed, reconnecting...');
      const delay = Math.min(1000 * 2 ** retryCount, 30000);
      setTimeout(() => this.setupWebSocket(retryCount + 1), delay);
    });
  }

  async loadFromFile() {
    try {
      const fileExists = await fs.access(this.filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        console.log('No existing liquidations file found, starting fresh');
        return;
      }

      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      const now = Date.now();

      // Modified to only keep 5 minutes of data on load
      this.liquidations = parsed
        .map((event) => ({
          ...event,
          timestamp: new Date(event.timestamp),
        }))
        .filter(
          (event) =>
            event.timestamp instanceof Date &&
            !isNaN(event.timestamp.getTime()) &&
            now - event.timestamp.getTime() <= 5 * 60 * 1000 // 5 minutes in milliseconds
        );
    } catch (err) {
      console.error('❌ Failed to load liquidations from file:', err);
      this.liquidations = [];
    }
  }

  async saveToFile() {
    try {
      const toSave = this.liquidations.map((event) => ({
        ...event,
        timestamp: event.timestamp.toISOString(),
      }));

      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (err) {
      console.error('❌ Failed to save liquidations to file:', err);
    }
  }

  cleanupOldEvents() {
    // Changed to keep only last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const initialLength = this.liquidations.length;
    this.liquidations = this.liquidations.filter(
      (event) => event.timestamp >= fiveMinutesAgo
    );
    if (this.liquidations.length !== initialLength) {
      this.saveToFile();
    }
  }

  getFiveMinuteLiquidationsSorted(sortBy = 'usdtValue', order = 'desc') {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const filtered = this.liquidations.filter(
      (event) => event.timestamp >= fiveMinutesAgo
    );
    return this.sortLiquidations(filtered, sortBy, order);
  }

  async getAggregatedBySymbol(
    sortBy = 'totalUsdtValue',
    order = 'desc',
    options = { saveToFile: true }
  ) {
    // Modified to only use last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const recentLiquidations = this.liquidations.filter(
      (event) => new Date(event.timestamp) >= fiveMinutesAgo
    );

    const aggregated = recentLiquidations.reduce((acc, curr) => {
      if (!acc[curr.symbol]) {
        acc[curr.symbol] = {
          symbol: curr.symbol,
          totalQuantity: 0,
          totalUsdtValue: 0,
          avgPrice: 0,
          count: 0,
          lastTimestamp: curr.timestamp,
          sides: { BUY: 0, SELL: 0 },
        };
      }

      const entry = acc[curr.symbol];
      entry.totalQuantity += curr.quantity;
      entry.totalUsdtValue += curr.usdtValue;
      entry.count += 1;
      entry.avgPrice = entry.totalUsdtValue / entry.totalQuantity;
      entry.sides[curr.side] += curr.quantity;

      if (new Date(entry.lastTimestamp) < new Date(curr.timestamp)) {
        entry.lastTimestamp = curr.timestamp;
      }

      return acc;
    }, {});

    const resultArray = Object.values(aggregated);
    const sortedResults = this.sortLiquidations(resultArray, sortBy, order);

    if (options.saveToFile) {
      const recentFilePath = './src/liquidations/recent_liquidations.json';
      try {
        await fs.mkdir(path.dirname(recentFilePath), { recursive: true });
        await fs.writeFile(
          recentFilePath,
          JSON.stringify(sortedResults, null, 2),
          'utf8'
        );
      } catch (error) {
        console.error('Error saving recent aggregated liquidations:', error);
        throw error;
      }
    }

    return sortedResults;
  }

  sortLiquidations(data, sortBy, order) {
    return data.sort((a, b) =>
      order === 'desc' ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy]
    );
  }

  getAllLiquidations() {
    return this.liquidations;
  }
}

const liquidations = new Liquidation();
module.exports = liquidations;