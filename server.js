const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PI_API = 'https://api.minepi.com/v2';

app.post('/api/approve', async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' });

  try {
    const key = process.env.PI_API_KEY;
    if (!key) return res.status(500).json({ error: 'PI_API_KEY not set' });

    const { data } = await axios.post(`${PI_API}/payments/${paymentId}/approve`, {}, {
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      timeout: 10000
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

app.post('/api/complete', async (req, res) => {
  const { paymentId, txid } = req.body;
  if (!paymentId || !txid) return res.status(400).json({ error: 'paymentId and txid required' });

  try {
    const key = process.env.PI_API_KEY;
    if (!key) return res.status(500).json({ error: 'PI_API_KEY not set' });

    const { data } = await axios.post(`${PI_API}/payments/${paymentId}/complete`, { txid }, {
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      timeout: 10000
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
