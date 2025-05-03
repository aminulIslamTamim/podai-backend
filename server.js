const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      retryWrites: true,
      w: 'majority'
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Call the connectDB function
connectDB();

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Podcast Schema
const podcastSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  audioUrl: { type: String },
  pdfUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Podcast = mongoose.model('Podcast', podcastSchema);

// Playback Progress Schema
const progressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  podcastId: { type: mongoose.Schema.Types.ObjectId, ref: 'Podcast' },
  progress: { type: Number, default: 0, min: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const Progress = mongoose.model('Progress', progressSchema);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${uuidv4()}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// User Registration
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User created successfully', userId: user._id });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Username already exists' });
    } else {
      res.status(400).json({ error: error.message });
    }
  }
});

// User Login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ message: 'Login successful', userId: user._id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Convert PDF to Podcast
app.post('/convert-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const pdfPath = req.file.path;
    const outputPath = `uploads/${Date.now()}-${uuidv4()}.mp3`;

    // Convert PDF to text and then to audio using text-to-speech
    await execAsync(`pdftotext "${pdfPath}" - | gtts-cli - -o "${outputPath}"`);

    const podcast = new Podcast({
      title: req.body.title || 'Converted PDF',
      description: req.body.description || 'PDF converted to podcast',
      audioUrl: `/${outputPath}`,
      pdfUrl: `/${pdfPath}`,
      userId: req.body.userId
    });

    await podcast.save();
    res.json(podcast);
  } catch (error) {
    console.error('PDF conversion error:', error);
    res.status(500).json({ error: 'Failed to convert PDF to podcast' });
  }
});

// Get all podcasts
app.get('/podcasts', async (req, res) => {
  try {
    const { userId } = req.query;
    const podcasts = await Podcast.find({ userId });
    res.json(podcasts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch podcasts' });
  }
});

// Update playback progress
app.put('/podcasts/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, progress } = req.body;
    
    if (progress < 0) {
      return res.status(400).json({ error: 'Progress cannot be negative' });
    }

    const podcast = await Podcast.findById(id);
    if (!podcast) {
      return res.status(404).json({ error: 'Podcast not found' });
    }

    const playbackProgress = await Progress.findOneAndUpdate(
      { userId, podcastId: id },
      { progress, lastUpdated: Date.now() },
      { upsert: true, new: true }
    );

    res.json(playbackProgress);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Get playback progress
app.get('/podcasts/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    const progress = await Progress.findOne({
      userId,
      podcastId: id
    });
    
    res.json(progress || { progress: 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ message: 'PodAi Backend API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});