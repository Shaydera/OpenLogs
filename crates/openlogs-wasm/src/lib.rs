//! The engine both OpenLogs front ends run in a Web Worker. JSON in, JSON out: the shapes
//! are the ones `ui/src/api/types.ts` mirrors.

mod engine;

use std::cell::RefCell;

pub use engine::Engine;
use wasm_bindgen::prelude::*;

thread_local! {
    static PANIC: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// The message of the last panic. A panic aborts the call with an `unreachable` trap that
/// carries no message, and leaves its `Session` unusable.
#[wasm_bindgen]
pub fn take_panic_message() -> Option<String> {
    PANIC.with(|panic| panic.borrow_mut().take())
}

#[wasm_bindgen]
#[derive(Default)]
pub struct Session {
    engine: Engine,
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Session {
        std::panic::set_hook(Box::new(|info| {
            PANIC.with(|panic| *panic.borrow_mut() = Some(info.to_string()));
        }));
        Session::default()
    }

    pub fn set_dungeons(&mut self, json: &str) -> Result<(), JsValue> {
        self.engine.set_dungeons(json).map_err(to_js)
    }

    pub fn set_channel_spells(&mut self, json: &str) -> Result<(), JsValue> {
        self.engine.set_channel_spells(json).map_err(to_js)
    }

    pub fn set_spell_classes(&mut self, json: &str) -> Result<(), JsValue> {
        self.engine.set_spell_classes(json).map_err(to_js)
    }

    pub fn begin_index(&mut self) {
        self.engine.begin_index();
    }

    pub fn index_feed(&mut self, chunk: &[u8]) {
        self.engine.index_feed(chunk);
    }

    pub fn finish_index(&mut self, log_id: &str, file_name: &str, size_bytes: f64) -> String {
        self.engine
            .finish_index(log_id, file_name, size_bytes as u64)
    }

    pub fn index_json(&self) -> String {
        self.engine.index_json()
    }

    pub fn restore_index(
        &mut self,
        index_json: &str,
        log_id: &str,
        file_name: &str,
        size_bytes: f64,
    ) -> Result<String, JsValue> {
        self.engine
            .restore_index(index_json, log_id, file_name, size_bytes as u64)
            .map_err(to_js)
    }

    /// `[prelude, end)` byte offsets of the pull.
    pub fn fight_range(&self, fight_index: u32) -> Result<Vec<f64>, JsValue> {
        let (start, end) = self.engine.fight_range(fight_index).map_err(to_js)?;
        Ok(vec![start as f64, end as f64])
    }

    pub fn touch_fight(&mut self, fight_index: u32) -> bool {
        self.engine.touch_fight(fight_index)
    }

    /// Changes whenever a stored index can no longer be read back.
    pub fn index_format_version(&self) -> u32 {
        openlogs_index::INDEX_FORMAT_VERSION
    }

    pub fn load_fight(
        &mut self,
        part: &[u8],
        base_offset: f64,
        fight_index: u32,
    ) -> Result<(), JsValue> {
        self.engine
            .load_fight(part, base_offset as u64, fight_index)
            .map_err(to_js)
    }

    pub fn call(&self, command: &str, args_json: &str) -> Result<String, JsValue> {
        self.engine.call(command, args_json).map_err(to_js)
    }
}

fn to_js(message: String) -> JsValue {
    JsValue::from_str(&message)
}
