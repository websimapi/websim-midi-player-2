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
    let segmentAnalysisProgress = 0; // Track analysis progress
    let totalSegments = 0; // Total number of segments to analyze

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
        statusMessage.textContent = 'AI is analyzing the song in 5-second segments...';
        
        // Reset playback state
        isPaused = false;
        pausedTime = 0;
        startOffset = 0;
        
        // Analyze the song in 5-second segments
        const totalDuration = Math.max(...originalMidiData.map(note => note.time + note.duration));
        const segmentSize = 5; // 5 seconds per segment
        totalSegments = Math.ceil(totalDuration / segmentSize);
        segmentAnalysisProgress = 0;
        aiSuggestions = [];
        
        analyzeSegments(originalMidiData, segmentSize, totalDuration)
            .then(() => {
                // Enable buttons after analysis is complete
                playButton.disabled = false;
                restartButton.disabled = false;
                statusMessage.textContent = 'Analysis complete. Press Play to hear the song with AI additions.';
                isAiAnalysisDone = true;
            });
    }

    async function analyzeSegments(allNotes, segmentSize, totalDuration) {
        // Create array of segments
        const segments = [];
        for (let start = 0; start < totalDuration; start += segmentSize) {
            const end = start + segmentSize;
            // Get notes that start in this segment
            const notesInSegment = allNotes.filter(note => 
                note.time >= start && note.time < end
            );
            segments.push({
                start,
                end,
                notes: notesInSegment
            });
        }
        
        // Analyze each segment sequentially
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            statusMessage.textContent = `Analyzing segment ${i+1}/${segments.length} (${Math.round(segment.start)}-${Math.round(segment.end)} seconds)...`;
            
            // Only analyze segments that have notes
            if (segment.notes.length > 0) {
                // Get context from nearby segments for better musical continuity
                const contextStart = Math.max(0, segment.start - segmentSize);
                const contextEnd = Math.min(totalDuration, segment.end + segmentSize);
                
                const contextNotes = allNotes.filter(note => 
                    note.time >= contextStart && note.time < contextEnd
                );
                
                // Generate AI suggestions for this segment
                const segmentSuggestions = await generateAiSuggestionsForSegment(
                    contextNotes, 
                    segment.start, 
                    segment.end
                );
                
                // Add to overall suggestions
                aiSuggestions.push(...segmentSuggestions);
            }
            
            segmentAnalysisProgress++;
        }
        
        // Sort all suggestions by time
        aiSuggestions.sort((a, b) => a.time - b.time);
        console.log("Complete AI suggestions across all segments:", aiSuggestions);
    }

    async function generateAiSuggestionsForSegment(notes, segmentStart, segmentEnd) {
        try {
            // Prepare music data for LLM analysis with more musical context
            const musicData = notes.map(note => ({
                noteName: note.name,
                midiNumber: note.midi,
                startTime: note.time.toFixed(3),  // More precise timing
                duration: note.duration.toFixed(3),
                velocity: note.velocity,
                // Mark if the note is part of the core segment or context
                inSegment: note.time >= segmentStart && note.time < segmentEnd
            }));

            // Calculate some basic musical metrics to help the LLM understand the piece
            const tempoEstimate = estimateTempo(notes);
            const keySignature = estimateKeySignature(notes);
            const segmentDuration = segmentEnd - segmentStart;
            
            // Group notes by measures to help the LLM understand the structure
            const measuresData = groupNotesByMeasures(notes, tempoEstimate);

            // Enhanced LLM prompt with musical structure information
            const prompt = `
As a musical AI composer, analyze these MIDI notes from a ${segmentDuration}-second segment (${segmentStart.toFixed(1)}-${segmentEnd.toFixed(1)} seconds) of the song:
${JSON.stringify(musicData, null, 2)}

Musical Analysis:
- Estimated tempo: ${tempoEstimate} BPM
- Estimated key: ${keySignature}
- Segment duration: ${segmentDuration.toFixed(2)} seconds
- Note density: ${(notes.length / segmentDuration).toFixed(2)} notes per second

Based on this melody and harmony pattern, suggest 5-8 additional notes that would complement this specific segment.
Focus on creating:
1. Interesting harmonies that enhance the existing chords
2. Countermelodies that work well with the main melody
3. Rhythmic elements that complement the existing rhythm
4. Musical embellishments like trills, grace notes, or arpeggios where appropriate

IMPORTANT: Your suggested notes MUST be within this specific time window: ${segmentStart.toFixed(2)}-${segmentEnd.toFixed(2)} seconds.
Make sure each suggested startTime is >= ${segmentStart.toFixed(2)} and < ${segmentEnd.toFixed(2)}.

Your additions should respect the musical style, harmony, and feel of the original piece.
The notes should be precisely timed to fit with the original composition.

Respond directly with JSON in this format:
{
  "suggestedNotes": [
    {
      "noteName": "C4",
      "midiNumber": 60,
      "startTime": 2.5,
      "duration": 0.25,
      "velocity": 0.75,
      "purpose": "harmony" // can be: harmony, countermelody, bass, embellishment, etc.
    }
    // more suggested notes
  ],
  "musicalChoices": "Brief explanation of your musical choices for this segment"
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
            console.log(`AI suggestions for segment ${segmentStart}-${segmentEnd}:`, result);

            // Format the suggestions for our player
            const segmentSuggestions = result.suggestedNotes.map(note => {
                // Ensure start time is within segment bounds
                const time = Math.max(segmentStart, Math.min(segmentEnd - 0.01, parseFloat(note.startTime)));
                
                return {
                    midi: note.midiNumber,
                    name: note.noteName,
                    time: time,
                    duration: parseFloat(note.duration),
                    velocity: note.velocity,
                    purpose: note.purpose || "addition",
                    isAiGenerated: true,
                    segment: `${segmentStart}-${segmentEnd}`
                };
            });
            
            // Filter out any invalid suggestions
            return segmentSuggestions.filter(note => 
                !isNaN(note.time) && !isNaN(note.duration) && note.time >= segmentStart && note.time < segmentEnd
            );

        } catch (error) {
            console.error(`Error generating AI suggestions for segment ${segmentStart}-${segmentEnd}:`, error);
            return [];
        }
    }

    async function generateAiSuggestions(capturedNotes) {
        // This function is kept for backward compatibility but now just calls the segment analysis
        const totalDuration = Math.max(...capturedNotes.map(note => note.time + note.duration));
        const segmentSize = 5; // 5 seconds per segment
        return analyzeSegments(capturedNotes, segmentSize, totalDuration);
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

    // Helper function to estimate tempo from note patterns
    function estimateTempo(notes) {
        if (notes.length < 2) return 120; // Default tempo
        
        // Find sequences of consecutive notes
        const intervals = [];
        for (let i = 1; i < notes.length; i++) {
            const interval = notes[i].time - notes[i-1].time;
            if (interval > 0 && interval < 2) { // Consider reasonable intervals
                intervals.push(interval);
            }
        }
        
        if (intervals.length === 0) return 120;
        
        // Find the most common interval (mode)
        const counts = {};
        intervals.forEach(i => {
            const rounded = Math.round(i * 100) / 100; // Round to nearest 0.01
            counts[rounded] = (counts[rounded] || 0) + 1;
        });
        
        let mostCommon = 0.5; // Default
        let maxCount = 0;
        
        for (const interval in counts) {
            if (counts[interval] > maxCount) {
                maxCount = counts[interval];
                mostCommon = parseFloat(interval);
            }
        }
        
        // Convert to BPM (assuming common interval is a quarter note)
        return Math.round(60 / mostCommon);
    }

    // Helper function to estimate key signature
    function estimateKeySignature(notes) {
        if (notes.length === 0) return "C major";
        
        // Count occurrences of each pitch class
        const pitchClasses = Array(12).fill(0);
        notes.forEach(note => {
            const pitchClass = note.midi % 12;
            pitchClasses[pitchClass] += note.duration; // Weight by duration
        });
        
        // Major key profiles (based on Krumhansl-Kessler profiles)
        const majorProfiles = [
            [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], // C
            [2.88, 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29], // C#
            [2.29, 2.88, 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66], // D
            [3.66, 2.29, 2.88, 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39], // D#
            [2.39, 3.66, 2.29, 2.88, 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19], // E
            [5.19, 2.39, 3.66, 2.29, 2.88, 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52], // F
            [2.52, 5.19, 2.39, 3.66, 2.29, 2.88, 6.35, 2.23, 3.48, 2.33, 4.38, 4.09], // F#
            [4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88, 6.35, 2.23, 3.48, 2.33, 4.38], // G
            [4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88, 6.35, 2.23, 3.48, 2.33], // G#
            [2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88, 6.35, 2.23, 3.48], // A
            [3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88, 6.35, 2.23], // A#
            [2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88, 6.35]  // B
        ];
        
        // Minor key profiles
        const minorProfiles = [
            [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], // C
            [3.17, 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34], // C#
            [3.34, 3.17, 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69], // D
            [2.69, 3.34, 3.17, 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98], // D#
            [3.98, 2.69, 3.34, 3.17, 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75], // E
            [4.75, 3.98, 2.69, 3.34, 3.17, 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54], // F
            [2.54, 4.75, 3.98, 2.69, 3.34, 3.17, 6.33, 2.68, 3.52, 5.38, 2.60, 3.53], // F#
            [3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17, 6.33, 2.68, 3.52, 5.38, 2.60], // G
            [2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17, 6.33, 2.68, 3.52, 5.38], // G#
            [5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17, 6.33, 2.68, 3.52], // A
            [3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17, 6.33, 2.68], // A#
            [2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17, 6.33]  // B
        ];
        
        // Calculate correlation with each profile
        let bestCorrelation = -1;
        let bestKey = 0;
        let isMajor = true;
        
        // Check major keys
        for (let i = 0; i < 12; i++) {
            const correlation = calculateCorrelation(pitchClasses, majorProfiles[i]);
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestKey = i;
                isMajor = true;
            }
        }
        
        // Check minor keys
        for (let i = 0; i < 12; i++) {
            const correlation = calculateCorrelation(pitchClasses, minorProfiles[i]);
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestKey = i;
                isMajor = false;
            }
        }
        
        // Convert to key name
        const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return `${keyNames[bestKey]} ${isMajor ? 'major' : 'minor'}`;
    }
    
    // Helper function to calculate correlation between two arrays
    function calculateCorrelation(array1, array2) {
        if (array1.length !== array2.length) return 0;
        
        let sum1 = 0, sum2 = 0, sum1Sq = 0, sum2Sq = 0, pSum = 0;
        const n = array1.length;
        
        for (let i = 0; i < n; i++) {
            sum1 += array1[i];
            sum2 += array2[i];
            sum1Sq += array1[i] ** 2;
            sum2Sq += array2[i] ** 2;
            pSum += array1[i] * array2[i];
        }
        
        const num = pSum - (sum1 * sum2 / n);
        const den = Math.sqrt((sum1Sq - sum1 ** 2 / n) * (sum2Sq - sum2 ** 2 / n));
        
        return den === 0 ? 0 : num / den;
    }
    
    // Helper function to group notes by measures for better analysis
    function groupNotesByMeasures(notes, tempo) {
        if (notes.length === 0) return [];
        
        // Estimate beats per measure (assuming 4/4 time signature)
        const beatsPerMeasure = 4;
        const secondsPerBeat = 60 / tempo;
        const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;
        
        // Group notes by measure
        const measures = [];
        let measureEnd = secondsPerMeasure;
        let currentMeasure = [];
        
        // Sort notes by time
        const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
        
        for (const note of sortedNotes) {
            while (note.time >= measureEnd) {
                if (currentMeasure.length > 0) {
                    measures.push(currentMeasure);
                    currentMeasure = [];
                }
                measureEnd += secondsPerMeasure;
            }
            currentMeasure.push(note);
        }
        
        // Add the last measure if it has notes
        if (currentMeasure.length > 0) {
            measures.push(currentMeasure);
        }
        
        return measures;
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