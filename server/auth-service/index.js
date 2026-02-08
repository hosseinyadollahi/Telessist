import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { query } from '../shared/db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Routes
app.get('/api/auth/status', (req, res) => {
  res.json({ status: 'Auth Service is running', service: 'auth-service' });
});

app.post('/api/auth/login', async (req, res) => {
    // Placeholder for actual login logic
    const { phone } = req.body;
    // const user = await query('SELECT * FROM users WHERE phone = $1', [phone]);
    res.json({ success: true, message: `Login attempt for ${phone}` });
});

app.listen(PORT, () => {
  console.log(`Auth Service running on port ${PORT}`);
});