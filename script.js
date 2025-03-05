document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const midiUpload = document.getElementById('midi-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const playButton = document.getElementById('play-button');
    const stopButton = document.getElementById('stop-button');
    const pianoContainer = document.getElementById('piano-container');
    const notesContainer = document.getElementById('notes-container');
    
    // State variables
    let midiFile = null;
    let player = null;
    let synth = null;
    let notes = [];
    let isPlaying = false;
    
    // Initialize the piano keyboard (88 keys)
    initPiano();
    
    // Event listeners
    midiUpload.addEventListener('change', handleMidiUpload);
    playButton.addEventListener('click', playMidi);
    stopButton.addEventListener('click', stopMidi);
    
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
        notesContainer.innerHTML = '';
        notes = [];
        
        // Get the longest track duration to set the visualizer time scale
        let maxDuration = 0;
        
        // Wait for next frame to ensure piano keys are properly rendered
        requestAnimationFrame(() => {
            // Process each track
            midiFile.tracks.forEach((track, trackIndex) => {
                const trackColor = getTrackColor(trackIndex);
                
                // Process notes in the track
                track.notes.forEach(note => {
                    // Calculate position and dimensions for visualization
                    const key = findPianoKey(note.midi);
                    if (!key) return;
                    
                    const keyPosition = key.getBoundingClientRect();
                    const containerPosition = pianoContainer.getBoundingClientRect();
                    const keyWidth = key.offsetWidth;
                    
                    // Calculate position relative to the container
                    const relativeLeft = key.offsetLeft;
                    
                    const noteElement = document.createElement('div');
                    noteElement.className = 'note';
                    noteElement.style.left = `${relativeLeft}px`;
                    noteElement.style.width = `${keyWidth}px`;
                    noteElement.style.height = `${(note.duration / 2) * 100}px`;
                    noteElement.style.backgroundColor = trackColor;
                    
                    noteElement.dataset.note = note.midi;
                    noteElement.dataset.time = note.time;
                    noteElement.dataset.duration = note.duration;
                    
                    notesContainer.appendChild(noteElement);
                    notes.push({
                        element: noteElement,
                        note: note
                    });
                    
                    // Update max duration
                    const noteEnd = note.time + note.duration;
                    if (noteEnd > maxDuration) {
                        maxDuration = noteEnd;
                    }
                });
            });
            
            // Enable play button
            playButton.disabled = false;
        });
    }
    
    function playMidi() {
        if (isPlaying || !midiFile) return;
        
        // Reset Tone.js context if it's suspended
        if (Tone.context.state !== 'running') {
            Tone.context.resume();
        }
        
        isPlaying = true;
        playButton.disabled = true;
        stopButton.disabled = false;
        
        // Schedule all notes
        const now = Tone.now();
        const animationDuration = 3; // seconds for note to fall down
        
        // Reset all falling notes
        document.querySelectorAll('.note.falling').forEach(el => {
            el.classList.remove('falling');
            el.style.transform = '';
        });
        
        midiFile.tracks.forEach(track => {
            track.notes.forEach(note => {
                // Schedule note
                synth.triggerAttackRelease(
                    note.name,
                    note.duration,
                    now + note.time,
                    note.velocity
                );
                
                // Find the note element
                const noteEl = document.querySelector(`.note[data-note="${note.midi}"][data-time="${note.time}"]`);
                if (noteEl) {
                    // Start animation before the note should play
                    const startAnimationTime = Math.max(0, note.time - animationDuration);
                    
                    // Set initial position at the top
                    noteEl.style.transform = 'translateY(0)';
                    
                    // Schedule falling animation
                    setTimeout(() => {
                        noteEl.style.transition = `transform ${animationDuration}s linear`;
                        noteEl.classList.add('falling');
                        
                        // Calculate exact distance to fall
                        const notesContainerHeight = notesContainer.offsetHeight;
                        const noteHeight = noteEl.offsetHeight;
                        const distance = notesContainerHeight + noteHeight;
                        
                        noteEl.style.transform = `translateY(${distance}px)`;
                    }, startAnimationTime * 1000);
                    
                    // Schedule visual feedback when note hits piano key
                    setTimeout(() => {
                        noteEl.classList.add('active');
                        
                        // Find the corresponding piano key
                        const key = findPianoKey(note.midi);
                        if (key) {
                            key.classList.add('active');
                        }
                    }, note.time * 1000);
                    
                    // Schedule note end
                    setTimeout(() => {
                        noteEl.classList.remove('active');
                        
                        // Find the corresponding piano key
                        const key = findPianoKey(note.midi);
                        if (key) {
                            key.classList.remove('active');
                        }
                    }, (note.time + note.duration) * 1000);
                }
            });
        });
        
        // Schedule stop at the end
        setTimeout(() => {
            stopMidi();
        }, (midiFile.duration + 1) * 1000);
    }
    
    function stopMidi() {
        if (!isPlaying) return;
        
        synth.releaseAll();
        // Tone.Transport.cancel();
        // Tone.Transport.stop();
        
        // Reset all active notes and keys
        document.querySelectorAll('.note.active, .piano-key.active').forEach(el => {
            el.classList.remove('active');
        });
        
        // Reset all falling animations
        document.querySelectorAll('.note.falling').forEach(el => {
            el.classList.remove('falling');
            el.style.transition = '';
            el.style.transform = '';
        });
        
        isPlaying = false;
        playButton.disabled = false;
        stopButton.disabled = true;
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
    
    function getTrackColor(index) {
        // Generate colors for different tracks
        const colors = [
            '#FF5252', '#FF4081', '#E040FB', '#7C4DFF', 
            '#536DFE', '#448AFF', '#40C4FF', '#18FFFF', 
            '#64FFDA', '#69F0AE', '#B2FF59', '#EEFF41', 
            '#FFFF00', '#FFD740', '#FFAB40', '#FF6E40'
        ];
        return colors[index % colors.length];
    }
});