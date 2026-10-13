/** U410: the short sound of a Toast, a soft two-note chime. The audio object is made on the first sound, never before, so an idle App holds none (U414). */
export type Chime = () => void;

export const webChime = (): Chime => {
  let context: AudioContext | undefined;

  return () => {
    try {
      context ??= new AudioContext();

      const start = context.currentTime;
      const gain = context.createGain();

      gain.connect(context.destination);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      [880, 1320].forEach((hertz, index) => {
        const tone = context!.createOscillator();

        tone.frequency.value = hertz;
        tone.connect(gain);
        tone.start(start + index * 0.09);
        tone.stop(start + 0.3);
      });

      void context.resume();
    } catch {
      // No sound is better than a failed event: the Toast itself still shows.
    }
  };
};
