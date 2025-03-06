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
    const analysisDuration = document.getElementById('analysis-duration');

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
    let isAiAnalysisDone = false;
    let scheduledEvents = [];

    // Initialize the piano keyboard (88 keys)
    initPiano();

    // Event listeners
    midiUpload.addEventListener('change', handleMidiUpload);
    playButton.addEventListener('click', () => {
        if (isPlaying) {
            pauseMidi();
        } else if (isPaused) {
            resumeMidi();
        } else {
            playMidi();
        }
    });
    stopButton.addEventListener('click', stopMidi);
    restartButton.addEventListener('click', restartMidi);

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
        isAiAnalysisDone = false;

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

        // Disable play button until AI analysis is complete
        playButton.disabled = true;
        restartButton.disabled = true;
        stopButton.disabled = true;

        // Show status message
        statusMessage.textContent = 'AI is analyzing the full song...';
        
        // Reset playback state
        isPaused = false;
        pausedTime = 0;
        startOffset = 0;
        
        // Automatically start AI analysis for the full song
        generateAiSuggestions(originalMidiData).then(() => {
            // Enable buttons after analysis is complete
            playButton.disabled = false;
            restartButton.disabled = false;
            statusMessage.textContent = 'Analysis complete. Press Play to hear the song with AI additions.';
            isAiAnalysisDone = true;
        });
    }

    async function playMidi() {
        if (isPlaying) return;
        
        if (isPaused) {
            resumeMidi();
            return;
        }

        // Wait for AI analysis to complete if it hasn't
        if (!isAiAnalysisDone) {
            statusMessage.textContent = 'Please wait for AI analysis to complete...';
            return;
        }

        // Reset Tone.js context if it's suspended
        if (Tone.context.state !== 'running') {
            Tone.context.resume();
        }

        isPlaying = true;
        playButton.textContent = 'Pause';
        stopButton.disabled = false;

        // Always combine original notes with AI suggestions
        const notesToPlay = [...originalMidiData, ...aiSuggestions].sort((a, b) => a.time - b.time);

        // Clear any active keys (visual cleanup)
        document.querySelectorAll('.piano-key.active, .piano-key.ai-active').forEach(el => {
            el.classList.remove('active', 'ai-active');
        });

        // Schedule all notes
        const now = Tone.now();
        scheduledEvents = [];

        notesToPlay.forEach(note => {
            if (note.time < startOffset) return; // Skip notes that should have already played
            
            const adjustedTime = note.time - startOffset;
            
            // Schedule note
            const noteOnEvent = Tone.Transport.schedule((time) => {
                synth.triggerAttackRelease(
                    note.name,
                    note.duration,
                    time,
                    note.velocity
                );
                
                // Find the corresponding piano key
                const key = findPianoKey(note.midi);
                if (key) {
                    if (note.isAiGenerated) {
                        key.classList.add('ai-active');
                    } else {
                        key.classList.add('active');
                    }
                }
            }, now + adjustedTime);
            scheduledEvents.push(noteOnEvent);

            // Schedule note end
            const noteOffEvent = Tone.Transport.schedule((time) => {
                // Find the corresponding piano key
                const key = findPianoKey(note.midi);
                if (key) {
                    key.classList.remove('active', 'ai-active');
                }
            }, now + adjustedTime + note.duration);
            scheduledEvents.push(noteOffEvent);
        });

        // Schedule stop at the end
        const totalDuration = Math.max(...notesToPlay.map(note => note.time + note.duration));
        const stopEvent = Tone.Transport.schedule(() => {
            stopMidi(false); // Don't reset offset when the song naturally ends
            playButton.textContent = 'Play';
        }, now + totalDuration - startOffset + 0.5);
        scheduledEvents.push(stopEvent);

        Tone.Transport.start();
    }

    function pauseMidi() {
        if (!isPlaying) return;
        
        // Cancel all scheduled events
        scheduledEvents.forEach(id => Tone.Transport.clear(id));
        scheduledEvents = [];
        
        synth.releaseAll();
        Tone.Transport.pause();
        
        // Remember where we paused
        pausedTime = Tone.Transport.seconds;
        startOffset += pausedTime;
        
        // Reset all active notes and keys
        document.querySelectorAll('.piano-key.active, .piano-key.ai-active').forEach(el => {
            el.classList.remove('active', 'ai-active');
        });
        
        isPlaying = false;
        isPaused = true;
        playButton.textContent = 'Resume';
    }
    
    function resumeMidi() {
        if (!isPaused) return;
        
        Tone.Transport.start();
        isPlaying = true;
        isPaused = false;
        playButton.textContent = 'Pause';
        
        // Reset the transport seconds to pick up from the right position
        Tone.Transport.seconds = 0;
        
        // Reschedule from current position
        playMidi();
    }

    function stopMidi(resetPosition = true) {
        if (!isPlaying && !isPaused) return;

        // Cancel all scheduled events
        scheduledEvents.forEach(id => Tone.Transport.clear(id));
        scheduledEvents = [];
        
        synth.releaseAll();
        Tone.Transport.stop();

        // Reset all active notes and keys
        document.querySelectorAll('.piano-key.active, .piano-key.ai-active').forEach(el => {
            el.classList.remove('active', 'ai-active');
        });

        isPlaying = false;
        isPaused = false;
        playButton.textContent = 'Play';
        
        if (resetPosition) {
            startOffset = 0;
            pausedTime = 0;
        }

        // If we were capturing but stopped early, cancel the capture
        if (isCapturing) {
            isCapturing = false;
            statusMessage.textContent = 'Capture canceled. Play again to restart capture.';
        }
    }
    
    function restartMidi() {
        stopMidi(true); // Stop and reset position
        // Small delay to ensure everything is reset before starting
        setTimeout(() => {
            playMidi(); // Start from the beginning
        }, 100);
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
As a musical AI, analyze these MIDI notes from the full song:
${JSON.stringify(musicData, null, 2)}

Based on this melody and harmony pattern, suggest 10-15 additional notes that would complement the piece.
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
            
            // Display AI explanation
            if (result.explanation) {
                statusMessage.textContent = "AI Explanation: " + result.explanation;
            }

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