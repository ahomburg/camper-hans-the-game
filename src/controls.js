// Tastatur (Pfeiltasten + WASD) -> einheitlicher Input-State.
export class Controls {
  constructor() {
    this.state = { up: false, down: false, left: false, right: false };
    this.onReset = null;
    this.onHonk = null;
    this.onEscape = null;
    this.onCycleView = null;
    this.onRadio = null;

    const keymap = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };
    window.addEventListener('keydown', (e) => {
      const k = keymap[e.code];
      if (k) { this.state[k] = true; e.preventDefault(); }
      if (e.code === 'KeyR' && this.onReset) this.onReset();
      if (e.code === 'KeyH' && !e.repeat && this.onHonk) this.onHonk();
      if (e.code === 'Escape' && this.onEscape) this.onEscape();
      if (e.code === 'KeyC' && !e.repeat && this.onCycleView) this.onCycleView();
      if (e.code === 'KeyM' && !e.repeat && this.onRadio) this.onRadio();
    });
    window.addEventListener('keyup', (e) => {
      const k = keymap[e.code];
      if (k) { this.state[k] = false; e.preventDefault(); }
    });
    window.addEventListener('blur', () => this.reset());

  }

  reset() {
    for (const k in this.state) this.state[k] = false;
  }
}
