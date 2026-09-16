use deno_core::OpState;
use deno_core::op2;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

struct Work {
    id: u32,
    seed: u32,
    rounds: u32,
    delay_ms: u32,
}
struct ComputePool {
    sender: Option<SyncSender<Work>>,
    results: Receiver<(u32, u32)>,
    thread: Option<JoinHandle<()>>,
    active: Option<u32>,
    next: u32,
}
impl ComputePool {
    /// 固定一个线程和一个在途槽，无无限排队。 / Fixed thread and in-flight slot, no unbounded queue.
    fn new() -> Option<Self> {
        let (sender, input) = mpsc::sync_channel::<Work>(1);
        let (output, results) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("battle-validation".into())
            .spawn(move || {
                while let Ok(work) = input.recv() {
                    // 仅验收用的有界延迟，使排队、缩容和心跳可观察。 / Bounded fixture delay for observable lifecycle tests.
                    thread::sleep(Duration::from_millis(u64::from(work.delay_ms)));
                    let result = simulate(work.seed, work.rounds);
                    if output.send((work.id, result)).is_err() {
                        break;
                    }
                }
            })
            .ok()?;
        Some(Self {
            sender: Some(sender),
            results,
            thread: Some(thread),
            active: None,
            next: 1,
        })
    }
    fn submit(&mut self, seed: u32, rounds: u32, delay_ms: u32) -> u32 {
        if self.active.is_some()
            || rounds == 0
            || rounds > 1_000_000
            || delay_ms > 250
            || self.next == u32::MAX
        {
            return 0;
        }
        let id = self.next;
        if self
            .sender
            .as_ref()
            .unwrap()
            .try_send(Work {
                id,
                seed,
                rounds,
                delay_ms,
            })
            .is_err()
        {
            return 0;
        }
        self.next += 1;
        self.active = Some(id);
        id
    }
    fn poll(&mut self, id: u32) -> f64 {
        if self.active != Some(id) {
            return -2.0;
        }
        match self.results.try_recv() {
            Ok((completed, result)) if completed == id => {
                self.active = None;
                f64::from(result)
            }
            _ => -1.0,
        }
    }
}
impl Drop for ComputePool {
    /// 关闭输入并等待有界工作结束；不遗留后台线程。 / Close input and join bounded work; leave no detached thread.
    fn drop(&mut self) {
        self.sender.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
/// 确定性模拟摘要，不是真实战斗规则。 / Deterministic simulation digest, not gameplay rules.
fn simulate(mut value: u32, rounds: u32) -> u32 {
    for _ in 0..rounds {
        value = value.wrapping_mul(1664525).wrapping_add(1013904223);
    }
    value
}
/// 只提交任务；CPU 计算不占用 V8 线程。 / Submit only; CPU work never runs on the V8 thread.
#[op2(fast)]
pub fn op_native_submit(state: &mut OpState, seed: u32, rounds: u32, delay_ms: u32) -> u32 {
    if !state.has::<ComputePool>() {
        let Some(pool) = ComputePool::new() else {
            return 0;
        };
        state.put(pool);
    }
    state
        .borrow_mut::<ComputePool>()
        .submit(seed, rounds, delay_ms)
}
/// 非阻塞取回完成结果；-1 待完成，-2 无此任务。 / Nonblocking completion poll: -1 pending, -2 unknown.
#[op2(fast)]
pub fn op_native_poll(state: &mut OpState, job: u32) -> f64 {
    if !state.has::<ComputePool>() {
        return -2.0;
    }
    state.borrow_mut::<ComputePool>().poll(job)
}

/// 无状态加法，用于验证 TS 到 Rust 的调用链。 / Stateless addition verifies the TS-to-Rust bridge.
#[op2(fast)]
pub fn op_native_add(left: f64, right: f64) -> f64 {
    add_numbers(left, right)
}

/// 算法与 op 注册分开，便于直接做 Rust 单测。 / Keep the algorithm separate from op registration for Rust unit tests.
fn add_numbers(left: f64, right: f64) -> f64 {
    left + right
}

#[cfg(test)]
mod tests {
    #[test]
    fn pool_is_bounded_and_computes_off_thread() {
        let mut pool = super::ComputePool::new().unwrap();
        assert_eq!(pool.submit(1, 1_000_001, 0), 0);
        let id = pool.submit(7, 100, 10);
        assert_ne!(id, 0);
        assert_eq!(pool.submit(2, 100, 0), 0);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        loop {
            let result = pool.poll(id);
            if result >= 0.0 {
                assert_eq!(result, f64::from(super::simulate(7, 100)));
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert_eq!(pool.poll(id), -2.0);
        assert_ne!(pool.submit(9, 100, 10), 0);
    }
    #[test]
    fn adds_numbers() {
        assert_eq!(super::add_numbers(2.0, 3.0), 5.0);
    }
}
