/**
 * AudioVisualizer - Siri-like smooth multi-layered sine wave visualizer
 * Animates a canvas element responding to real-time audio volume
 */
export class AudioVisualizer {
  constructor(canvasElement, audioPipelineInstance) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.audio = audioPipelineInstance;
    
    this.running = false;
    this.appState = 'idle'; // 'idle' | 'listening' | 'speaking'
    this.phase = 0;
    this.amplitude = 0;
    this.targetAmplitude = 0;

    // Handle responsiveness
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    
    // Scale for high DPI displays to prevent blurry canvas lines
    this.canvas.width = rect.width * dpr;
    this.canvas.height = Math.max(rect.height, 60) * dpr;
    
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    
    this.ctx.scale(dpr, dpr);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.draw();
  }

  stop() {
    this.running = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setAppState(state) {
    this.appState = state; // 'idle' | 'connecting' | 'listening' | 'speaking'
  }

  draw() {
    if (!this.running) return;
    requestAnimationFrame(() => this.draw());

    const ctx = this.ctx;
    const canvas = this.canvas;
    
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const centerY = height / 2;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get current volume from AudioPipeline
    let vol = 0;
    if (this.audio) {
      if (this.appState === 'listening') {
        vol = this.audio.getCaptureVolume();
      } else if (this.appState === 'speaking') {
        vol = this.audio.getPlaybackVolume();
      }
    }

    // Convert 0-255 volume to a normalized 0-1 scale
    // Divide by 100 to make it sensitive but capped
    const targetAmp = Math.min(vol / 100, 1.0);
    
    // Smooth interpolation (spring effect)
    this.amplitude += (targetAmp - this.amplitude) * 0.15;

    // Ensure there is always a very tiny idle wave so it looks alive
    const baseAmp = 0.02;
    const currentAmp = Math.max(this.amplitude, baseAmp);
    
    // Wave speed depends on volume
    this.phase += 0.04 + currentAmp * 0.12;

    // Define 3 overlaying waves with different colors, frequencies, and offsets
    const waves = [
      { color: 'rgba(99, 102, 241, 0.7)', frequency: 0.015, phaseShift: 0, lineWidth: 2.5, glow: 'rgba(99, 102, 241, 0.3)' },
      { color: 'rgba(6, 182, 212, 0.55)', frequency: 0.022, phaseShift: Math.PI / 2, lineWidth: 1.5, glow: 'none' },
      { color: 'rgba(236, 72, 153, 0.45)', frequency: 0.012, phaseShift: -Math.PI / 4, lineWidth: 1.5, glow: 'none' }
    ];

    waves.forEach((w) => {
      ctx.beginPath();
      ctx.strokeStyle = w.color;
      ctx.lineWidth = w.lineWidth;
      ctx.lineCap = 'round';
      
      if (w.glow !== 'none') {
        ctx.shadowBlur = 12;
        ctx.shadowColor = w.glow;
      } else {
        ctx.shadowBlur = 0;
      }

      for (let x = 0; x < width; x++) {
        // Siri quadratic envelope: pinches wave to 0 at the left and right edges
        const normX = x / width;
        const envelope = 4 * normX * (1 - normX);

        // Sine wave calculations
        const y = centerY + Math.sin(x * w.frequency - this.phase + w.phaseShift) * currentAmp * (height * 0.38) * envelope;
        
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // Reset shadow values for next draw
    ctx.shadowBlur = 0;
  }
}
