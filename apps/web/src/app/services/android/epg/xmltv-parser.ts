import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { parseXmltvDate } from './xmltv-date';

/**
 * Streaming XMLTV parser.
 *
 * Streaming, and emitting in batches, is the whole point: a week of guide data
 * for 6 000 channels is around a million programmes. Collecting them into one
 * array before writing would trade the measured 20 MB flat heap for hundreds of
 * megabytes on a device that has roughly 1 GB to spare.
 *
 * Only the fields the app actually reads are kept — a `<programme>` may carry a
 * dozen more, and retaining them would inflate every row for nothing.
 */

export interface XmltvChannel {
    id: string;
    displayName: string;
    iconUrl: string | null;
}

export interface XmltvProgram {
    channelId: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    iconUrl: string | null;
    episodeNum: string | null;
    rating: string | null;
}

export interface XmltvSink {
    onChannels: (channels: XmltvChannel[]) => Promise<void>;
    onPrograms: (programs: XmltvProgram[]) => Promise<void>;
}

/** Rows per write. Large enough to amortise the bridge, small enough to stay flat. */
const BATCH_SIZE = 500;

export class XmltvStreamParser {
    private readonly parser = new SaxesParser();

    private channels: XmltvChannel[] = [];
    private programs: XmltvProgram[] = [];

    private channel: Partial<XmltvChannel> | null = null;
    private program: Partial<XmltvProgram> | null = null;
    private textTarget: string | null = null;
    private text = '';

    /** Pending sink writes, awaited at `finish()` so nothing is lost. */
    private writes: Promise<void>[] = [];

    constructor(private readonly sink: XmltvSink) {
        this.parser.on('opentag', (tag) => this.openTag(tag));
        this.parser.on('text', (chunk) => {
            if (this.textTarget) {
                this.text += chunk;
            }
        });
        this.parser.on('closetag', (tag) => this.closeTag(tag.name));
    }

    write(chunk: string): void {
        this.parser.write(chunk);
    }

    async finish(): Promise<void> {
        this.parser.close();
        await this.flush(true);
        await Promise.all(this.writes);
    }

    private openTag(tag: SaxesTagPlain): void {
        const attributes = tag.attributes;

        switch (tag.name) {
            case 'channel':
                this.channel = { id: attributes['id'] ?? '', iconUrl: null };
                return;
            case 'programme':
                this.program = {
                    channelId: attributes['channel'] ?? '',
                    start: parseXmltvDate(attributes['start'] ?? ''),
                    stop: parseXmltvDate(attributes['stop'] ?? ''),
                    description: null,
                    category: null,
                    iconUrl: null,
                    episodeNum: null,
                    rating: null,
                };
                return;
            case 'icon': {
                // First icon wins; providers often list several sizes.
                const src = attributes['src'] ?? null;
                if (this.program && !this.program.iconUrl) {
                    this.program.iconUrl = src;
                } else if (this.channel && !this.channel.iconUrl) {
                    this.channel.iconUrl = src;
                }
                return;
            }
            case 'display-name':
            case 'title':
            case 'desc':
            case 'category':
            case 'episode-num':
            case 'value':
                this.textTarget = tag.name;
                this.text = '';
                return;
            default:
                return;
        }
    }

    private closeTag(name: string): void {
        if (this.textTarget === name) {
            this.assignText(name, this.text.trim());
            this.textTarget = null;
            this.text = '';
        }

        if (name === 'channel' && this.channel?.id) {
            this.channels.push({
                id: this.channel.id,
                displayName: this.channel.displayName ?? this.channel.id,
                iconUrl: this.channel.iconUrl ?? null,
            });
            this.channel = null;
            void this.flush(false);
            return;
        }

        if (name === 'programme' && this.program?.channelId && this.program.start) {
            this.programs.push({
                channelId: this.program.channelId,
                start: this.program.start,
                stop: this.program.stop ?? '',
                // A programme with no title is useless to display but its slot
                // still matters for "what is on now"; label it rather than drop it.
                title: this.program.title ?? 'No title',
                description: this.program.description ?? null,
                category: this.program.category ?? null,
                iconUrl: this.program.iconUrl ?? null,
                episodeNum: this.program.episodeNum ?? null,
                rating: this.program.rating ?? null,
            });
            this.program = null;
            void this.flush(false);
        }
    }

    private assignText(name: string, value: string): void {
        if (!value) {
            return;
        }

        if (this.program) {
            // First value wins: providers repeat these per language.
            if (name === 'title' && !this.program.title) {
                this.program.title = value;
            } else if (name === 'desc' && !this.program.description) {
                this.program.description = value;
            } else if (name === 'category' && !this.program.category) {
                this.program.category = value;
            } else if (name === 'episode-num' && !this.program.episodeNum) {
                this.program.episodeNum = value;
            } else if (name === 'value' && !this.program.rating) {
                this.program.rating = value;
            }
            return;
        }

        if (this.channel && name === 'display-name' && !this.channel.displayName) {
            this.channel.displayName = value;
        }
    }

    private flush(force: boolean): Promise<void> {
        if (this.channels.length >= BATCH_SIZE || (force && this.channels.length)) {
            const batch = this.channels;
            this.channels = [];
            this.writes.push(this.sink.onChannels(batch));
        }

        if (this.programs.length >= BATCH_SIZE || (force && this.programs.length)) {
            const batch = this.programs;
            this.programs = [];
            this.writes.push(this.sink.onPrograms(batch));
        }

        return Promise.resolve();
    }
}
