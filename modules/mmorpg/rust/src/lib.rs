//! MMORPG 权威数据与空间扩展，随模块组合编译。 / MMORPG authoritative data and spatial extension, compiled with the module.
mod aoi;
mod game;
pub mod generated;
pub mod native_data;
pub use generated::{BOOTSTRAP, extension};

/// 在所属进程线程上绑定资源根，不启动服务。 / Binds the asset root on the owning process thread without starting services.
pub fn configure_project_root(root: &std::path::Path) -> Result<(), deno_error::JsErrorBox> {
    native_data::configure_project_root(root)
}
