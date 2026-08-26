import express, { json } from 'express';
import cors from 'cors';
import { writeFileSync } from 'fs';

const app = express();
const PORT = 3000;

const COMMAND_FILE =
  'F:\\GAMMA\\mods\\Slot Machine\\gamedata\\scripts\\bridge\\command.txt';

app.use(cors());
app.use(json());

app.post('/give', (req, res) => {
  const { itemId } = req.body;

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

app.listen(PORT, () => {
  console.log(`GAMMA Bridge running on http://localhost:${PORT}`);
});
