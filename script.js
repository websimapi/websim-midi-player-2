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
    let isPlaying = false;
    let synth = null;
    let noteElements = [];
    let animationFrameId = null;
    let startTime = 0;
    let visualizerHeight = 0;
    let pixelsPerSecond = 0;
    
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
        noteElements = [];
        
        // Get visualizer dimensions
        visualizerHeight = notesContainer.clientHeight;
        
        // Calculate pixels per second based on song duration
        // Use a constant speed for all songs
        pixelsPerSecond = 200; // Adjust this value to control speed
        
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
                
                // Calculate note height based on duration
                const noteHeight = note.duration * pixelsPerSecond;
                noteElement.style.height = `${noteHeight}px`;
                noteElement.style.backgroundColor = trackColor;
                
                // Position all notes above the container initially with additional 200px offset
                noteElement.style.bottom = `${visualizerHeight + 200}px`;
                
                noteElement.dataset.note = note.midi;
                noteElement.dataset.time = note.time;
                noteElement.dataset.duration = note.duration;
                
                notesContainer.appendChild(noteElement);
                noteElements.push({
                    element: noteElement,
                    note: note,
                    keyElement: key
                });
            });
        });
        
        // Enable play button
        playButton.disabled = false;
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
        
        const now = Tone.now();
        startTime = performance.now();
        
        // Schedule all notes with Tone.js
        midiFile.tracks.forEach(track => {
            track.notes.forEach(note => {
                // Schedule note audio
                synth.triggerAttackRelease(
                    note.name,
                    note.duration,
                    now + note.time,
                    note.velocity
                );
            });
        });
        
        // Start animation loop
        animateNotes();
        
        // Schedule stop at the end
        Tone.Transport.schedule(() => {
            stopMidi();
        }, now + midiFile.duration + 0.5);
        
        Tone.Transport.start();
    }
    
    function animateNotes() {
        if (!isPlaying) return;
        
        // Calculate elapsed time since playback started
        const currentTime = (performance.now() - startTime) / 1000;
        
        // Update each note's position
        noteElements.forEach(({element, note, keyElement}) => {
            // Calculate the correct position based on current time
            const noteStartTime = note.time;
            const noteDuration = note.duration;
            const noteEndTime = noteStartTime + noteDuration;
            
            // Position calculation: how far the note has moved since the start
            const distanceToTravel = (currentTime - noteStartTime) * pixelsPerSecond;
            
            // Add a 200px offset to fix alignment (visualizerHeight + 200)
            const bottomPosition = (visualizerHeight + 200) - distanceToTravel;
            
            // Set the position
            element.style.bottom = `${bottomPosition}px`;
            
            // Note activation/deactivation
            if (currentTime >= noteStartTime && currentTime < noteEndTime) {
                // Note is currently playing
                element.classList.add('active');
                keyElement.classList.add('active');
            } else if (currentTime >= noteEndTime) {
                // Note has finished playing
                element.classList.remove('active');
                keyElement.classList.remove('active');
                element.classList.add('finished');
            }
        });
        
        // Continue animation loop
        animationFrameId = requestAnimationFrame(animateNotes);
    }
    
    function stopMidi() {
        if (!isPlaying) return;
        
        // Cancel animation frame
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        
        synth.releaseAll();
        Tone.Transport.cancel();
        Tone.Transport.stop();
        
        // Reset all active notes and keys
        document.querySelectorAll('.note.active, .piano-key.active').forEach(el => {
            el.classList.remove('active');
        });
        
        // Reset note positions and remove finished class
        noteElements.forEach(({element}) => {
            element.style.bottom = `${visualizerHeight + 200}px`;
            element.classList.remove('falling');
            element.classList.remove('active');
            element.classList.remove('finished');
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