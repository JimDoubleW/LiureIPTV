// @capacitor/filesystem's web fallback needs IndexedDB, which jsdom does not
// implement — writeFile() throws "This browser doesn't support IndexedDB"
// under this project's ESM jest preset. Specs that exercise the Android
// backup-share path get this stub instead, matching the video.js pattern
// (test-stubs/video-js.js): a static moduleNameMapper redirect, since
// jest.unstable_mockModule does not reliably intercept this package here.
const writeFile = jest.fn();

module.exports = {
    Directory: { Cache: 'CACHE' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: { writeFile },
};
