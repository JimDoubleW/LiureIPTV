// See test-stubs/capacitor-filesystem.js for why this is a static
// moduleNameMapper stub rather than a per-test jest.unstable_mockModule.
const share = jest.fn();

module.exports = {
    Share: { share },
};
