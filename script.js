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
    const captureDuration = document.getElementById('capture-duration');

    // State variables
    let midiFile = null;
    let player = null;
    let synth = null;
    let isPlaying = false;
    let isPaused = false;
    let pauseTime = 0;
    let startOffset = 0;
    let aiSuggestions = [];
    let originalMidiData = [];
    let isCapturing = false;
    let captureStartTime = 0;
    let isAiMode = false;
    let scheduledEvents = [];

    // Initialize the piano keyboard (88 keys)
    initPiano();

    // Event listeners
    midiUpload.addEventListener('change', handleMidiUpload);
    playButton.addEventListener('click', playMidi);
    stopButton.addEventListener('click', stopMidi);
    restartButton.addEventListener('click', restartMidi);
    aiToggle.addEventListener('change', (e) => {
        isAiMode = e.target.checked;
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
        isPaused = false;
        startOffset = 0;
        pauseTime = 0;

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

        // Enable play button
        playButton.disabled = false;
        restartButton.disabled = true;

        // Disable the stop button until playing
        stopButton.disabled = true;

        // Reset status message
        statusMessage.textContent = '';
    }

    function restartMidi() {
        if (isPlaying) {
            stopMidi();
        }
        startOffset = 0;
        pauseTime = 0;
        isPaused = false;
        playButton.textContent = "Play";
        playMidi();
    }

    async function playMidi() {
        if (isPlaying && !isPaused) return;
        
        if (!midiFile) return;

        // Reset Tone.js context if it's suspended
        if (Tone.context.state !== 'running') {
            await Tone.context.resume();
        }

        if (isPaused) {
            // Resume playback from pause point
            isPaused = false;
            startOffset = pauseTime;
            playButton.textContent = "Pause";
        } else {
            // Start fresh playback
            isPlaying = true;
            playButton.textContent = "Pause";
        }
        
        playButton.disabled = false;
        stopButton.disabled = false;
        restartButton.disabled = false;

        // If in AI mode and we have suggestions, play with AI additions
        const notesToPlay = isAiMode && aiSuggestions.length > 0 
            ? [...originalMidiData, ...aiSuggestions] 
            : originalMidiData;

        // Sort combined notes by time
        notesToPlay.sort((a, b) => a.time - b.time);

        // Get selected capture duration
        const selectedDuration = captureDuration.value;
        const captureDurationValue = selectedDuration === 'full' 
            ? Math.max(...originalMidiData.map(note => note.time + note.duration))
            : parseInt(selectedDuration);

        // If we're not in AI mode and we don't have AI suggestions yet, capture for LLM analysis
        if (!isAiMode && aiSuggestions.length === 0) {
            isCapturing = true;
            captureStartTime = Tone.now();
            statusMessage.textContent = selectedDuration === 'full' 
                ? 'Capturing full song for AI analysis...' 
                : `Capturing first ${captureDurationValue} seconds for AI analysis...`;
        }

        // Schedule all notes
        const now = Tone.now();
        scheduledEvents = []; // Clear previously scheduled events

        notesToPlay.forEach(note => {
            // Skip notes that have already played (for resume functionality)
            if (note.time < startOffset) return;
            
            // Schedule note with offset
            const noteStartTime = now + (note.time - startOffset);
            
            // Schedule note
            const attackId = Tone.Transport.schedule((time) => {
                synth.triggerAttack(
                    note.name,
                    time,
                    note.velocity
                );
                
                // Find the corresponding piano key for visual feedback
                const key = findPianoKey(note.midi);
                if (key) {
                    if (note.isAiGenerated) {
                        key.classList.add('ai-active');
                    } else {
                        key.classList.add('active');
                    }
                }
            }, noteStartTime);
            
            // Schedule note release
            const releaseId = Tone.Transport.schedule((time) => {
                synth.triggerRelease(note.name, time);
                
                // Find the corresponding piano key for visual feedback
                const key = findPianoKey(note.midi);
                if (key) {
                    key.classList.remove('active', 'ai-active');
                }
            }, noteStartTime + note.duration);
            
            scheduledEvents.push(attackId, releaseId);
        });

        // If capturing, schedule the LLM analysis
        if (isCapturing) {
            const captureEndTime = selectedDuration === 'full' 
                ? null 
                : now + captureDurationValue - startOffset;
            
            if (captureEndTime) {
                const captureEventId = Tone.Transport.schedule(async () => {
                    // Get the notes in the capture duration
                    const capturedData = originalMidiData.filter(note => note.time < captureDurationValue);
                    isCapturing = false;

                    // Show analyzing message
                    statusMessage.textContent = 'AI is analyzing your music...';

                    // Request AI suggestions
                    await generateAiSuggestions(capturedData);

                    // Update status once we have suggestions
                    statusMessage.textContent = 'AI suggestions ready! Toggle "AI Mode" to hear them.';
                }, captureEndTime);
                
                scheduledEvents.push(captureEventId);
            } else {
                // For full song capture, we'll handle it at the end
            }
        }

        // Schedule stop at the end
        const totalDuration = Math.max(...notesToPlay.map(note => note.time + note.duration));
        const endTime = now + (totalDuration - startOffset) + 0.5;
        
        const endEventId = Tone.Transport.schedule(() => {
            // If we were capturing the full song, now is the time to analyze
            if (isCapturing && selectedDuration === 'full') {
                isCapturing = false;
                statusMessage.textContent = 'AI is analyzing your music...';
                
                // Process all notes for AI suggestions
                generateAiSuggestions(originalMidiData).then(() => {
                    statusMessage.textContent = 'AI suggestions ready! Toggle "AI Mode" to hear them.';
                });
            }
            
            stopMidi(false); // false means don't reset start offset
        }, endTime);
        
        scheduledEvents.push(endEventId);

        // Start transport if not already running
        if (Tone.Transport.state !== 'started') {
            Tone.Transport.start();
        }
        
        isPlaying = true;
    }

    function stopMidi(resetPosition = true) {
        if (!isPlaying) return;

        if (!resetPosition && !isPaused) {
            // Pausing
            isPaused = true;
            pauseTime = getCurrentPlaybackPosition();
            playButton.textContent = "Resume";
        } else {
            // Full stop
            isPaused = false;
            startOffset = 0;
            pauseTime = 0;
            playButton.textContent = "Play";
            restartButton.disabled = true;
        }

        // Cancel all scheduled events
        scheduledEvents.forEach(id => {
            Tone.Transport.clear(id);
        });
        scheduledEvents = [];

        synth.releaseAll();
        
        // Only stop transport if we're doing a full stop
        if (resetPosition) {
            Tone.Transport.stop();
        }

        // Reset all active notes and keys
        document.querySelectorAll('.piano-key.active, .piano-key.ai-active').forEach(el => {
            el.classList.remove('active', 'ai-active');
        });

        if (resetPosition) {
            isPlaying = false;
            playButton.disabled = false;
            stopButton.disabled = true;

            // If we were capturing but stopped early, cancel the capture
            if (isCapturing) {
                isCapturing = false;
                statusMessage.textContent = 'Capture canceled. Play again to restart capture.';
            }
        } else {
            // Just pausing
            stopButton.disabled = false;
        }
    }

    // Function to get current playback position
    function getCurrentPlaybackPosition() {
        if (!isPlaying) return 0;
        const elapsedTime = Tone.Transport.seconds;
        return startOffset + elapsedTime;
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
As a musical AI, analyze these MIDI notes from the ${captureDuration.value === 'full' ? 'full song' : `first ${captureDuration.value} seconds of a piece`}:
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