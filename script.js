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
        
        // Process each track
        midiFile.tracks.forEach((track, trackIndex) => {
            const trackColor = getTrackColor(trackIndex);
            
            // Process notes in the track
            track.notes.forEach(note => {
                // Calculate position and dimensions for visualization
                const key = findPianoKey(note.midi);
                if (!key) return;
                
                const keyRect = key.getBoundingClientRect();
                const keyWidth = keyRect.width;
                const keyLeft = key.offsetLeft;
                
                const noteElement = document.createElement('div');
                noteElement.className = 'note';
                noteElement.style.left = `${keyLeft}px`;
                noteElement.style.width = `${keyWidth}px`;
                
                // Position notes above viewport initially, they'll fall down during playback
                const heightScale = 100; // Scale factor for note height
                noteElement.style.bottom = `${notesContainer.clientHeight + (note.time * heightScale)}px`;
                noteElement.style.height = `${note.duration * heightScale}px`;
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
        
        // Also enable the stop button if we reset after stopping
        stopButton.disabled = true;
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
        const heightScale = 100; // Same scale factor as in parseMidiFile
        
        // Start animation of falling notes
        notes.forEach(({element, note}) => {
            // Set transition for faster animation - adjusted to match actual play time
            const animationDuration = note.time;
            element.style.transition = `bottom ${animationDuration}s linear`;
            // Animate to final position - delayed by a small amount to ensure the transition applies
            setTimeout(() => {
                element.style.bottom = '0px';
            }, 10);
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
                
                // Schedule visual feedback
                Tone.Transport.schedule((time) => {
                    const noteEl = document.querySelector(`.note[data-note="${note.midi}"][data-time="${note.time}"]`);
                    if (noteEl) {
                        noteEl.classList.add('active');
                        
                        // Find the corresponding piano key
                        const key = findPianoKey(note.midi);
                        if (key) {
                            key.classList.add('active');
                        }
                        
                        // Create shatter effect
                        createShatterEffect(noteEl);
                    }
                }, now + note.time);
                
                // Schedule note end
                Tone.Transport.schedule((time) => {
                    const noteEl = document.querySelector(`.note[data-note="${note.midi}"][data-time="${note.time}"]`);
                    if (noteEl) {
                        noteEl.classList.remove('active');
                        
                        // Find the corresponding piano key
                        const key = findPianoKey(note.midi);
                        if (key) {
                            key.classList.remove('active');
                        }
                    }
                }, now + note.time + note.duration);
            });
        });
        
        // Schedule stop at the end
        Tone.Transport.schedule(() => {
            stopMidi();
        }, now + midiFile.duration + 1);
        
        Tone.Transport.start();
    }
    
    function stopMidi() {
        if (!isPlaying) return;
        
        synth.releaseAll();
        Tone.Transport.cancel();
        Tone.Transport.stop();
        
        // Reset all active notes and keys
        document.querySelectorAll('.note.active, .piano-key.active').forEach(el => {
            el.classList.remove('active');
        });
        
        // Reset note positions
        notes.forEach(({element, note}) => {
            const time = parseFloat(element.dataset.time);
            const heightScale = 100;
            element.style.transition = 'none'; // Disable transition for immediate positioning
            element.style.bottom = `${notesContainer.clientHeight + (time * heightScale)}px`;
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
    
    function createShatterEffect(noteEl) {
        // Get the note's color and dimensions
        const noteColor = window.getComputedStyle(noteEl).backgroundColor;
        const noteRect = noteEl.getBoundingClientRect();
        const noteWidth = noteEl.offsetWidth;
        
        // Create particles for shatter effect
        const particleCount = 8;
        const particleSize = noteWidth / 4;
        
        // Create the particles at the bottom of the note
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'note-particle';
            particle.style.backgroundColor = noteColor;
            particle.style.width = `${particleSize}px`;
            particle.style.height = `${particleSize}px`;
            
            // Position particle at the bottom of the note
            particle.style.left = `${(i / particleCount) * noteWidth}px`;
            particle.style.bottom = '0px';
            
            noteEl.appendChild(particle);
            
            // Remove particles after animation finishes
            setTimeout(() => {
                if (particle.parentNode) {
                    particle.parentNode.removeChild(particle);
                }
            }, 500);
        }
        
        // Gradually "eat" the note by reducing its height
        const originalHeight = parseFloat(noteEl.style.height);
        const consumptionRate = originalHeight / (parseFloat(noteEl.dataset.duration) * 1000); // pixels per millisecond
        
        let consumed = 0;
        const consumeInterval = setInterval(() => {
            consumed += consumptionRate * 16; // 16ms is approx frame time at 60fps
            if (consumed >= originalHeight) {
                clearInterval(consumeInterval);
                noteEl.style.height = '0px';
            } else {
                noteEl.style.height = `${originalHeight - consumed}px`;
            }
        }, 16);
    }
});