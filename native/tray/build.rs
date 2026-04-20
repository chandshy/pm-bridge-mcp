// napi-build generates `index.d.ts` and `index.js` from the `#[napi]`
// annotations on the Rust side, plus the platform glue that loads the
// right `.node` per host. Required at compile time — without this,
// the JS wrapper has no idea what symbols the addon exports.

extern crate napi_build;

fn main() {
    napi_build::setup();
}
