const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/podai', { useNewUrlParser: true, useUnifiedTopology: true });

const podcastSchema = new mongoose.Schema({
  id: String,
  title: String,
  description: String,
  audioUrl: String,
  progress: Number,
});
const Podcast = mongoose.model('Podcast', podcastSchema);

const podcasts = [
  {
    id: "1",
    title: "The Future of Learning",
    description: "Audio-Based Educational Resources",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    progress: 0
  },
  {
    id: "2",
    title: "AI in Education",
    description: "How AI is changing classrooms",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    progress: 0
  }
];

Podcast.insertMany(podcasts).then(() => {
  console.log("Sample podcasts inserted!");
  mongoose.disconnect();
}); 