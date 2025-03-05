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
        
        // Calculate visualization height based on total duration
        const visualizerHeight = notesContainer.clientHeight;
        
        // Adjust this value to zoom in more (higher value) or less (lower value)
        const PIXELS_PER_SECOND = visualizerHeight / Math.min(midiFile.duration, 10); // Show at most 10 seconds view
        
        // Process each track
        midiFile.tracks.forEach((track, trackIndex) => {
            const trackColor = getTrackColor(trackIndex);
            
            // Process notes in the track
            track.notes.forEach(note => {
                // Calculate position and dimensions for visualization
                const key = findPianoKey(note.midi);
                if (!key) return;
                
                const keyLeft = key.offsetLeft;
                const keyWidth = key.offsetWidth;
                
                const noteElement = document.createElement('div');
                noteElement.className = 'note';
                noteElement.style.left = `${keyLeft}px`;
                noteElement.style.width = `${keyWidth}px`;
                noteElement.style.height = `${note.duration * PIXELS_PER_SECOND}px`;
                noteElement.style.bottom = `${visualizerHeight + (note.time * PIXELS_PER_SECOND)}px`; // Position relative to bottom
                noteElement.style.backgroundColor = trackColor;
                noteElement.style.position = 'absolute';
                
                noteElement.dataset.note = note.midi;
                noteElement.dataset.time = note.time;
                noteElement.dataset.duration = note.duration;
                
                notesContainer.appendChild(noteElement);
                notes.push({
                    element: noteElement,
                    note: note,
                    bottom: parseFloat(noteElement.style.bottom)
                });
            });
        });
        
        // Enable play button
        playButton.disabled = false;
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
        const visualizerHeight = notesContainer.clientHeight;
        const pianoHeight = pianoContainer.clientHeight;
        
        // Schedule all notes
        notes.forEach(({element, note}) => {
            // Calculate the total distance the note needs to travel
            const totalDistance = parseFloat(element.style.bottom) + pianoHeight;
            
            // Calculate the fall duration 
            const fallDuration = note.time;
            
            // Set initial position (off-screen)
            element.style.transition = 'none';
            element.style.transform = 'translateY(-' + totalDistance + 'px)';
            
            // Force reflow
            element.offsetHeight;
            
            // Schedule note to start falling
            setTimeout(() => {
                // Set the transition timing
                element.style.transition = `transform ${fallDuration}s linear`;
                
                // Start the falling animation to reach the piano keys exactly when the note should play
                element.style.transform = 'translateY(0)';
            }, 10);
            
            // Schedule note playback
            synth.triggerAttackRelease(
                note.name,
                note.duration,
                now + note.time,
                note.velocity
            );
            
            // Schedule visual feedback when note is played
            Tone.Transport.schedule((time) => {
                element.classList.add('active');
                
                // Find the corresponding piano key
                const key = findPianoKey(note.midi);
                if (key) {
                    key.classList.add('active');
                }
            }, now + note.time);
            
            // Schedule note end
            Tone.Transport.schedule((time) => {
                element.classList.remove('active');
                
                // Find the corresponding piano key
                const key = findPianoKey(note.midi);
                if (key) {
                    key.classList.remove('active');
                }
            }, now + note.time + note.duration);
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
        
        // Reset all notes to their original positions
        notes.forEach(({element}) => {
            element.style.transition = 'none';
            element.style.transform = 'translateY(-' + parseFloat(element.style.bottom) + 'px)';
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
            
            // Adjust width based on key type - slightly wider keys
            key.style.width = isBlack ? '10px' : '16px';
            
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