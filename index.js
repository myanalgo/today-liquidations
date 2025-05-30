const express = require('express');
const cors = require('cors');
const fs = require('fs'); // Use core fs module for readFileSync
const fsPromises = require('fs').promises; // Keep promises for async operations
const https = require('https');
const liquidations = require('./src/Liquidation.js');
const os = require('os');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 22223;

// Load SSL certificate and key
const privateKey = fs.readFileSync('src/key.pem', 'utf8');
const certificate = fs.readFileSync('src/cert.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route for /liquidations
app.get('/liquidations', async (req, res) => {
  const filePath = './src/liquidations/liquidations.json';
  try {
    const fileExists = await fsPromises.access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!fileExists) {
      return res.status(404).json({
        success: false,
        message: 'No liquidation data available yet',
      });
    }
    const data = await fsPromises.readFile(filePath, 'utf8');
    const liquidations = JSON.parse(data);
    const consolidated = liquidations.reduce((acc, curr) => {
      const key = `${curr.symbol}-${curr.side}`;
      if (!acc[key]) {
        acc[key] = { ...curr, quantity: 0, usdtValue: 0 };
      }
      acc[key].quantity += curr.quantity;
      acc[key].usdtValue += curr.usdtValue;
      if (new Date(curr.timestamp) > new Date(acc[key].timestamp)) {
        acc[key].timestamp = curr.timestamp;
      }
      return acc;
    }, {});
    const result = Object.values(consolidated).sort((a, b) => b.usdtValue - a.usdtValue);
    result.forEach(item => delete item.price);
    res.status(200).json(result.slice(0, 12));
  } catch (error) {
    console.error('Error in /liquidations route:', error.message, { stack: error.stack });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve liquidation data',
      error: error.message,
    });
  }
});

// Fallback for unmatched routes
app.use((req, res) => {
  console.error(`Endpoint not found: ${req.path}`);
  res.status(404).json({ error: 'Endpoint not found' });
});

(async () => {
  const run24_7 = async () => {
    try {
      await liquidations.getAllLiquidations();
      await liquidations.getFiveMinuteLiquidationsSorted('usdtValue', 'desc');
      await liquidations.getAggregatedBySymbol('usdtValue', 'desc');
    } catch (error) {
      console.error('Error in run24_7:', error);
    }
  };
  
  // Run every 5 seconds
  setInterval(run24_7, 5000);
  
  // Dynamically find the 192.168.x.x IP address
  const interfaces = os.networkInterfaces();
  const IP = Object.values(interfaces)
    .flat()
    .find(i => i.family === 'IPv4' && i.address.startsWith('192.168'))?.address || '0.0.0.0';
  
  // Start HTTPS server
  const server = https.createServer(credentials, app);
  server.listen(PORT, IP, () => {
    console.log(`Server is running on https://${IP}:${PORT}`);
  });
})();
