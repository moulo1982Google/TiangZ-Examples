use deno_core::{JsRuntime, RuntimeOptions};

fn runtime() -> JsRuntime {
    let mut runtime = JsRuntime::new(RuntimeOptions {
        extensions: vec![tiangz_mmorpg_native::extension()],
        ..Default::default()
    });
    runtime
        .execute_script("module:mmorpg", tiangz_mmorpg_native::BOOTSTRAP)
        .unwrap();
    runtime
}

#[test]
fn native_item_round_trips_through_v8_ops() {
    let mut runtime = runtime();
    runtime
            .execute_script(
                "test:native-item.js",
                r#"
                const handle = __etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entityCreate(
                  2,
                  new Float64Array([100, 200, 3001, 2, 0, 1, 1]),
                );
                if (__etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entityGetNumber(handle, 3) !== 3001) {
                  throw new Error("Item configId did not round-trip");
                }
                __etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entitySetNumber(handle, 4, 3);
                if (__etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entityGetNumber(handle, 4) !== 3) {
                  throw new Error("Item count did not round-trip");
                }
                __etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entityDestroy(handle);
                let rejected = false;
                try { __etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entityGetNumber(handle, 4); } catch (_) { rejected = true; }
                if (!rejected) throw new Error("stale Item handle was accepted");
                "ok";
                "#,
            )
            .unwrap();
}

#[test]
fn generated_native_bridge_rejects_uint32_wraparound() {
    let mut runtime = runtime();
    let error = runtime
            .execute_script(
                "test:native-op-validation.js",
                r#"__etsModuleNative_1daec00d71cba725a25be43a8a06fc02d4b2d5b2d13641289e2a60521900ed95.entityDestroy(-1);"#,
            )
            .unwrap_err();
    assert!(error.to_string().contains("handle"));
    assert!(error.to_string().contains("integer"));
}
