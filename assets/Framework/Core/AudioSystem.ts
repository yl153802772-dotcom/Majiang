import { AudioClip, AudioSource, Node, isValid, clamp01 } from 'cc';
import { ResManager } from './ResManager';
import type { ResourceHandle } from '../Kernel/ResourceCache';
import { LifecycleScope } from '../Kernel/LifecycleScope';
import { rollbackCleanups, runCleanups } from '../Kernel/Contracts';
type Voice = { source: AudioSource; clip: ResourceHandle<AudioClip>; channel: string };
/** Bounded voices; releases on AudioSource.ENDED, independent of game time scaling. */
export class AudioSystem {
    private static instance = new AudioSystem();
    static get Instance(): AudioSystem { return this.instance; }
    private root?: Node;
    private scope = new LifecycleScope();
    private music?: Voice;
    private voices = new Set<Voice>();
    private limit = 16;
    private pendingVoices = 0;
    private musicToken = 0;
    private generation = 0;
    private enabled = true;
    private suspended = false;
    private volume = 1;
    init(root: Node, maxVoices = 16): void {
        if (this.root) throw new Error('Audio already initialized');
        if (!Number.isInteger(maxVoices) || maxVoices < 1) throw new Error('Invalid audio voice limit');
        if (!isValid(root)) throw new Error('Audio root is invalid');
        this.root = root; this.limit = maxVoices; this.scope = new LifecycleScope(); ++this.generation;
    }
    private requireRoot(): Node { if (!this.root || !isValid(this.root)) throw new Error('Audio not initialized'); return this.root; }
    async playBGM(path: string, bundle?: string): Promise<void> {
        const root = this.requireRoot(), token = ++this.musicToken, scope = this.scope;
        if (!this.enabled) return;
        const clip = await ResManager.Instance.acquire(path, AudioClip, { bundle, scope, timeoutMs: 15000 });
        if (token !== this.musicToken || !this.enabled || !scope.isActive || !isValid(root) || clip.released) { clip.release(); return; }
        try { this.stopMusicVoice(); }
        catch (error) { rollbackCleanups(error, 'Music replacement failed', [() => clip.release()]); }
        const voice = this.createVoice(root, clip, 'music', this.volume, true);
        this.music = voice;
        try { if (!this.suspended) voice.source.play(); }
        catch (error) { rollbackCleanups(error, 'Music start rollback failed', [() => this.stopMusicVoice()]); }
    }
    private stopMusicVoice(): void {
        if (!this.music) return;
        const voice = this.music; this.music = undefined;
        this.cleanupVoice(voice);
    }
    stopBGM(): void { ++this.musicToken; this.stopMusicVoice(); }
    async playSound(path: string, options: { bundle?: string; channel?: string; volume?: number } = {}): Promise<boolean> {
        const root = this.requireRoot(), scope = this.scope, generation = this.generation;
        if (!this.enabled || this.voices.size + this.pendingVoices >= this.limit) return false;
        this.pendingVoices++;
        try {
        const clip = await ResManager.Instance.acquire(path, AudioClip, { bundle: options.bundle, scope, timeoutMs: 15000 });
        if (generation !== this.generation || !this.enabled || !scope.isActive || !isValid(root) || clip.released || this.voices.size >= this.limit) { clip.release(); return false; }
        const voice = this.createVoice(root, clip, options.channel ?? 'effect', clamp01((options.volume ?? 1) * this.volume), false);
        this.voices.add(voice);
        try {
            voice.source.node.once(AudioSource.EventType.ENDED, () => this.release(voice));
            if (!this.suspended) voice.source.play();
        } catch (error) { rollbackCleanups(error, 'Sound start rollback failed', [() => this.release(voice)]); }
        return true;
        } finally { if (generation === this.generation) this.pendingVoices--; }
    }
    playUISound(path: string, bundle?: string): Promise<boolean> { return this.playSound(path, { bundle, channel: 'ui' }); }
    private release(voice: Voice): void {
        if (!this.voices.delete(voice)) return;
        this.cleanupVoice(voice);
    }
    private createVoice(root: Node, clip: ResourceHandle<AudioClip>, channel: string, volume: number, loop: boolean): Voice {
        let node: Node | undefined, source: AudioSource | undefined;
        try {
            node = new Node(loop ? 'Music' : 'Voice'); node.setParent(root);
            source = node.addComponent(AudioSource); source.clip = clip.value;
            source.loop = loop; source.volume = volume;
            return { source, clip, channel };
        } catch (error) {
            rollbackCleanups(error, 'Audio construction rollback failed', [
                () => source?.stop(), () => { if (source) source.clip = null; },
                () => { node?.destroy(); }, () => clip.release(),
            ]);
        }
    }
    private cleanupVoice(voice: Voice): void {
        runCleanups('Audio voice cleanup failed', [
            () => voice.source.stop(), () => { voice.source.clip = null; },
            () => { voice.source.node.destroy(); }, () => voice.clip.release(),
        ]);
    }
    setSound(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) runCleanups('Audio mute cleanup failed', [() => this.stopBGM(), () => this.stopAllSfx()]);
    }
    setVolume(volume: number): void {
        this.volume = clamp01(volume);
        if (this.music) this.music.source.volume = this.volume;
        for (const voice of this.voices) voice.source.volume = this.volume;
    }
    /** Pauses playback without releasing clips or changing the user's mute choice. */
    setSuspended(paused: boolean): void {
        if (this.suspended === paused) return;
        this.suspended = paused;
        const voices = [...(this.music ? [this.music] : []), ...Array.from(this.voices)];
        runCleanups('Audio suspension failed', voices.map(voice => () => { if (paused) voice.source.pause(); else if (this.enabled) voice.source.play(); }));
    }
    stopChannel(channel: string): void {
        runCleanups('Audio channel cleanup failed', Array.from(this.voices).filter(voice => voice.channel === channel).map(voice => () => this.release(voice)));
    }
    stopAllSfx(): void {
        runCleanups('Sound collection cleanup failed', Array.from(this.voices).map(voice => () => this.release(voice)));
    }
    dispose(): void {
        const music = this.music, voices = Array.from(this.voices), scope = this.scope;
        this.music = undefined; this.voices.clear(); this.root = undefined;
        ++this.musicToken; ++this.generation; this.pendingVoices = 0; this.suspended = false;
        runCleanups('Audio system cleanup failed', [
            () => { if (music) this.cleanupVoice(music); },
            ...voices.map(voice => () => this.cleanupVoice(voice)), () => scope.dispose(),
        ]);
    }
}
