import express from 'express';
import cors from 'cors';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMAND_FILE =
  'F:\\GAMMA\\mods\\Slot Machine\\gamedata\\scripts\\bridge\\command.txt';

app.use(cors());
app.use(express.json());

// API
app.post('/give', (req, res) => {
  const { itemId } = req.body;

  console.log('GIVE WEAPON:', itemId);

  if (!itemId) {
    return res.status(400).json({
      error: 'itemId is required',
    });
  }

  try {
    writeFileSync(COMMAND_FILE, itemId, 'utf8');

    console.log(`Command sent to GAMMA: ${itemId}`);

    res.json({
      success: true,
      itemId,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Failed to write command file',
    });
  }
});

// React
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GAMMA Weapon Roulette running on http://localhost:${PORT}`);
});
