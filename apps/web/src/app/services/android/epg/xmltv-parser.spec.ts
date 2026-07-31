import {
    XmltvStreamParser,
    type XmltvChannel,
    type XmltvProgram,
} from './xmltv-parser';

async function parse(xml: string) {
    const channels: XmltvChannel[] = [];
    const programs: XmltvProgram[] = [];
    const parser = new XmltvStreamParser({
        onChannels: async (batch) => {
            channels.push(...batch);
        },
        onPrograms: async (batch) => {
            programs.push(...batch);
        },
    });

    parser.write(xml);
    await parser.finish();
    return { channels, programs };
}

describe('XmltvStreamParser', () => {
    it('reads channels with their display name and icon', async () => {
        const { channels } = await parse(`
            <tv>
              <channel id="tf1.fr">
                <display-name>TF1</display-name>
                <icon src="http://example.com/tf1.png" />
              </channel>
            </tv>
        `);

        expect(channels).toEqual([
            { id: 'tf1.fr', displayName: 'TF1', iconUrl: 'http://example.com/tf1.png' },
        ]);
    });

    it('falls back to the id when a channel has no display name', async () => {
        const { channels } = await parse('<tv><channel id="x.fr"></channel></tv>');

        expect(channels[0].displayName).toBe('x.fr');
    });

    it('reads programmes with times normalised to UTC', async () => {
        const { programs } = await parse(`
            <tv>
              <programme start="20260415053700 +0200" stop="20260415063700 +0200" channel="tf1.fr">
                <title>Camping Paradis</title>
                <desc>Un episode</desc>
                <category>Serie</category>
              </programme>
            </tv>
        `);

        expect(programs[0]).toMatchObject({
            channelId: 'tf1.fr',
            start: '2026-04-15T03:37:00.000Z',
            stop: '2026-04-15T04:37:00.000Z',
            title: 'Camping Paradis',
            description: 'Un episode',
            category: 'Serie',
        });
    });

    it('keeps the first of repeated multilingual titles', async () => {
        const { programs } = await parse(`
            <tv>
              <programme start="20260415053700" stop="20260415063700" channel="c">
                <title lang="fr">Titre</title>
                <title lang="en">Title</title>
              </programme>
            </tv>
        `);

        expect(programs[0].title).toBe('Titre');
    });

    it('labels a titleless programme instead of dropping its slot', async () => {
        // The slot still answers "what is on now"; discarding it would leave a
        // hole in the guide.
        const { programs } = await parse(
            '<tv><programme start="20260415053700" stop="20260415063700" channel="c"></programme></tv>'
        );

        expect(programs[0].title).toBe('No title');
    });

    it('skips a programme with no channel or no start', async () => {
        const { programs } = await parse(`
            <tv>
              <programme stop="20260415063700" channel="c"></programme>
              <programme start="20260415053700"></programme>
            </tv>
        `);

        expect(programs).toHaveLength(0);
    });

    it('parses across chunk boundaries, as a stream delivers it', async () => {
        // The document arrives in network-sized pieces, which routinely split
        // a tag or a text node in half.
        const channels: XmltvChannel[] = [];
        const parser = new XmltvStreamParser({
            onChannels: async (batch) => {
                channels.push(...batch);
            },
            onPrograms: async () => undefined,
        });

        parser.write('<tv><channel id="tf1.fr"><display-na');
        parser.write('me>TF1</display-name></channel></tv>');
        await parser.finish();

        expect(channels).toEqual([
            { id: 'tf1.fr', displayName: 'TF1', iconUrl: null },
        ]);
    });

    it('emits everything even when the last batch is partial', async () => {
        const many = Array.from({ length: 501 }, (_, i) =>
            `<channel id="c${i}"><display-name>C${i}</display-name></channel>`
        ).join('');

        const { channels } = await parse(`<tv>${many}</tv>`);

        expect(channels).toHaveLength(501);
    });
});
