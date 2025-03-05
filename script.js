document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const midiUpload = document.getElementById('midi-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const playButton = document.getElementById('play-button');
    const stopButton = document.getElementById('stop-button');
    const restartButton = document.getElementById('restart-button');
    const pianoContainer = document.getElementById('piano-container');
    const notesContainer = document.getElementById('notes-container');
    const statusMessage = document.getElementById('status-message');
    const aiToggle = document.getElementById('ai-toggle');
    const fullAnalysisToggle = document.getElementById('full-analysis-toggle');

    // State variables
    let midiFile = null;
    let player = null;
    let synth = null;
    let isPlaying = false;
    let isPaused = false;
    let pausedTime = 0;
    let startOffset = 0;
    let aiSuggestions = [];
    let originalMidiData = [];
    let isCapturing = false;
    let captureStartTime = 0;
    let isAiMode = false;
    let isFullAnalysis = false;
    let analysisDuration = 15; // Default 15 seconds
    let scheduledEvents = [];

    // Initialize the piano keyboard (88 keys)
    initPiano();

    // Event listeners
    midiUpload.addEventListener('change', handleMidiUpload);
    playButton.addEventListener('click', togglePlayPause);
    stopButton.addEventListener('click', stopMidi);
    restartButton.addEventListener('click', restartMidi);
    aiToggle.addEventListener('change', (e) => {
        isAiMode = e.target.checked;
    });
    fullAnalysisToggle.addEventListener('change', (e) => {
        isFullAnalysis = e.target.checked;
        if (isFullAnalysis) {
            analysisDuration = Number.MAX_SAFE_INTEGER; // Effectively the full song
        } else {
            analysisDuration = 15; // Default 15 seconds
        }
    });

    // Initialize Tone.js synth
    synth = new Tone.PolySynth(Tone.Synth).toDestination();

    function handleMidiUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        fileNameDisplay.textContent = file.name;

        const reader = new FileReader();

        reader.onload = function(e) {
            const midiData = e.target.result;
            parseMidiFile(midiData);
        };

        reader.readAsArrayBuffer(file);
    }

    function parseMidiFile(midiData) {
        midiFile = new Midi(midiData);
        console.log('MIDI file loaded:', midiFile);

        // Clear previous notes
        originalMidiData = [];
        aiSuggestions = [];

        // Process each track to extract note data
        midiFile.tracks.forEach((track, trackIndex) => {
            // Process notes in the track
            track.notes.forEach(note => {
                originalMidiData.push({
                    midi: note.midi,
                    name: note.name,
                    time: note.time,
                    duration: note.duration,
                    velocity: note.velocity
                });
            });
        });

        // Sort notes by time
        originalMidiData.sort((a, b) => a.time - b.time);

        // Enable play and restart buttons
        playButton.disabled = false;
        restartButton.disabled = false;

        // Reset status message and playback state
        statusMessage.textContent = '';
        isPaused = false;
        pausedTime = 0;
        startOffset = 0;

        // Disable the stop button until playing
        stopButton.disabled = true;
    }

    function togglePlayPause() {
        if (!midiFile) return;

        if (isPlaying) {
            // Pause playback
            pauseMidi();
        } else {
            // Start or resume playback
            playMidi();
        }
    }

    function pauseMidi() {
        if (!isPlaying) return;

        // Store the current time as the pause time
        pausedTime = Tone.now() - startOffset;
        
        // Cancel all scheduled events
        Tone.Transport.cancel();
        scheduledEvents.forEach(id => Tone.Transport.clear(id));
        scheduledEvents = [];
        
        // Stop the transport
        Tone.Transport.pause();
        synth.releaseAll();
        
        // Update UI
        document.querySelectorAll('.piano-key.active, .piano-key.ai-active').forEach(el => {
            el.classList.remove('active', 'ai-active');
        });
        
        isPlaying = false;
        isPaused = true;
        playButton.textContent = "Resume";
        stopButton.disabled = false;
        
        // If we were capturing but paused, keep the capture state
        if (isCapturing) {
            statusMessage.textContent = 'Capture paused. Resume to continue capture.';
        }
    }

    async function playMidi() {
        if (isPlaying || !midiFile) return;

        // Reset Tone.js context if it's suspended
        if (Tone.context.state !== 'running') {
            await Tone.context.resume();
        }

        isPlaying = true;
        playButton.textContent = "Pause";
        playButton.disabled = false;
        stopButton.disabled = false;
        restartButton.disabled = false;

        // If in AI mode and we have suggestions, play with AI additions
        const notesToPlay = isAiMode && aiSuggestions.length > 0 
            ? [...originalMidiData, ...aiSuggestions] 
            : originalMidiData;

        // Sort combined notes by time
        notesToPlay.sort((a, b) => a.time - b.time);

        // If we're not in AI mode and we don't have AI suggestions yet, capture for LLM analysis
        if (!isAiMode && aiSuggestions.length === 0 && !isPaused) {
            isCapturing = true;
            captureStartTime = Tone.now();
            statusMessage.textContent = isFullAnalysis 
                ? 'Capturing full song for AI analysis...' 
                : `Capturing first ${analysisDuration} seconds for AI analysis...`;
        }

        // Calculate the start time based on whether we're resuming or starting fresh
        startOffset = isPaused ? pausedTime : Tone.now();
        const now = Tone.now();
        
        // Filter notes based on the current playback position if resuming
        const remainingNotes = isPaused 
            ? notesToPlay.filter(note => note.time > (pausedTime - startOffset + 0.1)) 
            : notesToPlay;

        // Schedule all notes
        remainingNotes.forEach(note => {
            // Adjust time based on the pause time if resuming
            const adjustedTime = isPaused 
                ? now + (note.time - (pausedTime - startOffset + 0.1)) 
                : now + note.time;

            // Schedule note
            synth.triggerAttackRelease(
                note.name,
                note.duration,
                adjustedTime,
                note.velocity
            );

            // Schedule visual feedback
            const noteOnId = Tone.Transport.schedule((time) => {
                // Find the corresponding piano key
                const key = findPianoKey(note.midi);
                if (key) {
                    if (note.isAiGenerated) {
                        key.classList.add('ai-active');
                    } else {
                        key.classList.add('active');
                    }
                }
            }, adjustedTime);
            scheduledEvents.push(noteOnId);

            // Schedule note end
            const noteOffId = Tone.Transport.schedule((time) => {
                // Find the corresponding piano key
                const key = findPianoKey(note.midi);
                if (key) {
                    key.classList.remove('active', 'ai-active');
                }
            }, adjustedTime + note.duration);
            scheduledEvents.push(noteOffId);
        });

        // If capturing, schedule the LLM analysis
        if (isCapturing) {
            const captureEndTime = isFullAnalysis 
                ? Math.max(...notesToPlay.map(note => note.time + note.duration))
                : analysisDuration;
                
            const captureId = Tone.Transport.schedule(async () => {
                // Get the notes from the captured duration
                const capturedData = originalMidiData.filter(note => note.time < captureEndTime);
                isCapturing = false;

                // Show analyzing message
                statusMessage.textContent = 'AI is analyzing your music...';

                // Request AI suggestions
                await generateAiSuggestions(capturedData);

                // Update status once we have suggestions
                statusMessage.textContent = 'AI suggestions ready! Toggle "AI Mode" to hear them.';
            }, now + captureEndTime);
            scheduledEvents.push(captureId);
        }

        // Schedule stop at the end
        const totalDuration = Math.max(...notesToPlay.map(note => note.time + note.duration));
        const stopId = Tone.Transport.schedule(() => {
            stopMidi();
        }, now + totalDuration + 0.5);
        scheduledEvents.push(stopId);

        Tone.Transport.start();
        isPaused = false;
    }

    function stopMidi() {
        if (!midiFile) return;

        synth.releaseAll();
        Tone.Transport.cancel();
        scheduledEvents.forEach(id => Tone.Transport.clear(id));
        scheduledEvents = [];
        Tone.Transport.stop();

        // Reset all active notes and keys
        document.querySelectorAll('.piano-key.active, .piano-key.ai-active').forEach(el => {
            el.classList.remove('active', 'ai-active');
        });

        isPlaying = false;
        isPaused = false;
        pausedTime = 0;
        startOffset = 0;
        playButton.textContent = "Play";
        playButton.disabled = false;
        stopButton.disabled = true;

        // If we were capturing but stopped early, cancel the capture
        if (isCapturing) {
            isCapturing = false;
            statusMessage.textContent = 'Capture canceled. Play again to restart capture.';
        }
    }

    function restartMidi() {
        stopMidi();
        // Reset playback position
        pausedTime = 0;
        startOffset = 0;
        // Start playing from the beginning
        playMidi();
    }

    async function generateAiSuggestions(capturedNotes) {
        try {
            // Prepare music data for LLM analysis
            const musicData = capturedNotes.map(note => ({
                noteName: note.name,
                midiNumber: note.midi,
                startTime: note.time,
                duration: note.duration,
                velocity: note.velocity
            }));

            // LLM prompt to analyze music and suggest additions
            const prompt = `
As a musical AI, analyze these MIDI notes ${isFullAnalysis ? 'from the full song' : 'from the first part of a piece'}:
${JSON.stringify(musicData, null, 2)}

Based on this melody and harmony pattern, suggest 5-10 additional notes that would complement the piece.
Focus on creating interesting harmonies, counterpoint, or embellishments that enhance the musical idea.
The suggestions should match the style and feel of the original piece.

Respond directly with JSON in this format:
{
  "suggestedNotes": [
    {
      "noteName": "C4",
      "midiNumber": 60,
      "startTime": 2.5,
      "duration": 0.25,
      "velocity": 0.75
    }
    // more suggested notes
  ],
  "explanation": "Brief explanation of your musical choices"
}`;

            // Call the LLM for analysis
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                json: true
            });

            // Parse the LLM response
            const result = JSON.parse(completion.content);
            console.log("AI suggestions:", result);

            // Format the suggestions for our player
            aiSuggestions = result.suggestedNotes.map(note => ({
                midi: note.midiNumber,
                name: note.noteName,
                time: note.startTime,
                duration: note.duration,
                velocity: note.velocity,
                isAiGenerated: true
            }));

            console.log("Processed AI suggestions:", aiSuggestions);

        } catch (error) {
            console.error("Error generating AI suggestions:", error);
            statusMessage.textContent = 'Error generating AI suggestions.';
            aiSuggestions = [];
        }
    }

    function initPiano() {
        // Create 88 piano keys (standard piano)
        const startNote = 21; // A0
        const endNote = 108; // C8

        for (let midi = startNote; midi <= endNote; midi++) {
            const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
            const key = document.createElement('div');
            key.className = `piano-key ${isBlack ? 'black' : 'white'}`;
            key.dataset.midi = midi;

            // Adjust width based on key type
            key.style.width = isBlack ? '8px' : '14px';

            pianoContainer.appendChild(key);
        }
    }

    function findPianoKey(midiNote) {
        return pianoContainer.querySelector(`.piano-key[data-midi="${midiNote}"]`);
    }
});