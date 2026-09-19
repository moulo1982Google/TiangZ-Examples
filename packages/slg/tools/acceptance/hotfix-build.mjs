import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { command, root, engine, hash } from './environment.mjs';

/** 只变换隔离源码；每个替换必须唯一命中，源码漂移时失败。 / Transform isolated source only; fail on source drift. */
export function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, `fixture source anchor changed: ${from.slice(0, 60)}`);
  return source.replace(from, to);
}
export async function treeHashes(directory) {
  const files = {};
  async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw Error('artifact links are forbidden');
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full); else files[path.relative(directory, full).replaceAll('\\', '/')] = hash(await readFile(full));
  } }
  await walk(directory); return files;
}

/** 通过正式Luban、协议及Bundle生成器建立冻结基线和候选。 / Build frozen baseline and candidates with official generators. */
export async function buildHotfix(directory, env) {
  const modules = path.join(directory, 'modules'), dist = path.join(directory, 'dist');
  await cp(path.join(root, 'modules'), modules, { recursive: true });
  const module = path.join(modules, 'slg');
  const tool = async (name, args = []) => {
    try { return await command(process.execPath, [path.join(engine, 'tools', name), '--modules-dir', modules, ...args], { cwd: engine, env, timeout: 180000 }); }
    catch (cause) { throw Error('fixture build failed at ' + name + ' ' + args.join(' '), { cause }); }
  };
  const manifestPath = path.join(module, 'tiangz.module.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.gameConfig = { project: 'game_config/luban.conf', target: 'server', generatedCode: 'src/model/generated/config', generatedData: 'game_config/generated', validator: 'src/model/FixtureConfigValidator.ts' };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(path.join(module, 'src/model/FixtureConfigValidator.ts'), `
/** 固定基线业务校验；热更不能替换该Model规则。 / Frozen Model validation cannot be replaced by hotfix. */
export function validate(tables: Readonly<Record<string, unknown>>): void {
  const rules = tables.rules_tbrule as { cost: number; duration: number }[];
  if (!Array.isArray(rules) || rules.length !== 1 || !Number.isSafeInteger(rules[0]?.cost) || rules[0]!.cost <= 0 || !Number.isSafeInteger(rules[0]?.duration) || rules[0]!.duration <= 0) throw new Error("isolated SLG rules validation failed");
}
`);

  await mkdir(path.join(module, 'game_config/Defines'), { recursive: true });
  await mkdir(path.join(module, 'game_config/Data'), { recursive: true });
  await writeFile(path.join(module, 'game_config/luban.conf'), JSON.stringify({ groups: [{ names: ['s'], default: true }], schemaFiles: [{ fileName: 'Defines', type: '' }], dataDir: 'Data', targets: [{ name: 'server', manager: 'Tables', groups: ['s'], topModule: 'cfg' }], xargs: [] }));
  const schemaPath = path.join(module, 'game_config/Defines/rules.xml');
  const schema = '<module name="rules"><bean name="Rule"><var name="id" type="int"/><var name="version" type="int"/><var name="cost" type="int"/><var name="duration" type="int"/></bean><table name="TbRule" value="Rule" input="*rules@rules.json"/></module>';
  await writeFile(schemaPath, schema);
  const dataPath = path.join(module, 'game_config/Data/rules.json');
  const rules = version => ({ rules: [{ id: 1, version, cost: version === 1 ? 200 : 240, duration: version === 1 ? 10000 : 12000 }] });
  await writeFile(dataPath, JSON.stringify(rules(1)));
  const protoPath = path.join(module, 'proto/Slg_C_32000.proto');
  const proto = replaceOnce(await readFile(protoPath, 'utf8'), '  CommandReceipt receipt = 13;', `  CommandReceipt receipt = 13;
  uint32 fixture_code = 14;
  uint32 fixture_config = 15;
  string fixture_config_hash = 16;
  uint32 fixture_pending = 17;
  uint32 fixture_timers = 18;
  uint32 fixture_residents = 19;
  uint32 fixture_deadlines = 20;
  uint32 fixture_cost = 21;
  uint32 fixture_duration = 22;`);
  await writeFile(protoPath, proto);
  const gameplayPath = path.join(module, 'src/hotfix/Gameplay.ts');
  let gameplay = await readFile(gameplayPath, 'utf8');
  gameplay = 'import { ModuleConfigRegistry } from "#tiangz/model";\n' + gameplay;
  gameplay = replaceOnce(gameplay, 'spend(building.level * 200); building.dueAt = now + building.level * 10000;', `const rule = (ModuleConfigRegistry.Get("org.tiangz.slg").tables.rules_tbrule as readonly { cost: number; duration: number }[])[0]!;
    spend(building.level * rule.cost); building.dueAt = now + building.level * rule.duration;`);
  await writeFile(gameplayPath, gameplay);
  const systemPath = path.join(module, 'src/hotfix/SlgGameSystem.ts');
  let system = await readFile(systemPath, 'utf8');
  system = replaceOnce(system, 'import { systemFor,', 'import { ModuleConfigRegistry, systemFor,');
  system = replaceOnce(system, '    const { player: p, world } = await this.Run(request, true);', `    const fixtureCode = 1;
    const { player: p, world } = await this.Run(request, true);
    const config = ModuleConfigRegistry.Get("org.tiangz.slg");
    const rule = (config.tables.rules_tbrule as readonly { version: number; cost: number; duration: number }[])[0]!;`);
  system = replaceOnce(system, '    return { player: p.id,', `    return { fixtureCode, fixtureConfig: rule.version, fixtureConfigHash: config.dataFingerprint,
      fixtureCost: rule.cost, fixtureDuration: rule.duration, fixturePending: this.pendingPlayers.size,
      fixtureTimers: this.playerTimers.size, fixtureResidents: this.residents.size, fixtureDeadlines: this.deadlines.size,
      player: p.id,`);
  const fixtureModelPath = path.join(module, 'src/model/SlgWorldScene.ts');
  let fixtureModel = await readFile(fixtureModelPath, 'utf8');
  fixtureModel = replaceOnce(fixtureModel, '  protected override readonly mailbox = "unordered" as const;', `  protected override readonly mailbox = "unordered" as const;
  /** 仅夹具指标；不改变队列或业务调度。 / Fixture diagnostics do not alter queue or gameplay scheduling. */
  override metricsSnapshot() {
    const base = super.metricsSnapshot(), game = this.GetComponent(SlgGameComponent);
    return { ...base, customMetrics: [...base.customMetrics, { name: "slg_fixture",
      values: { pending: game?.pendingPlayers.size ?? 0, timers: game?.playerTimers.size ?? 0,
        residents: game?.residents.size ?? 0, deadlines: game?.deadlines.size ?? 0 },
      kinds: { pending: "gauge" as const, timers: "gauge" as const, residents: "gauge" as const, deadlines: "gauge" as const } }] };
  }`);
  fixtureModel = replaceOnce(fixtureModel, '  durable = false;', '  FixtureCommitGuard(): number { return 0; }\n  durable = false;');
  fixtureModel += '\n// 固定不可替换槽，仅供隔离提交回滚验证。 / Frozen slot for isolated commit rollback validation.\nObject.defineProperty(SlgGameComponent.prototype, "FixtureCommitGuard", { configurable: false, writable: false });\n';
  await writeFile(fixtureModelPath, fixtureModel);
  await writeFile(systemPath, system);
  await tool('codegen_module_protocol.mjs', ['--update-locks']);
  await tool('prepare_game_modules.mjs');
  await tool('codegen_module_configs.mjs');
  await tool('typecheck_game_modules.mjs');
  await tool('build_runtime_bundles.mjs', ['--out-dir', dist]);
  const { immutableCandidateFromOutput } = await import(pathToFileURL(path.join(engine, 'tools/build_result.mjs')));
  const pairs = {}, starts = {};
  const savePair = async (name, candidate) => {
    const target = path.join(directory, 'pairs', name); await cp(candidate, target, { recursive: true }); pairs[name] = target;
    // 每份启动包都由完整基线和正式候选组成，保留Model与其他启动资源。 / Overlay official candidates onto a complete startup baseline.
    const startup = path.join(directory, 'starts', name); await cp(dist, startup, { recursive: true, filter: source => !source.includes('hotfix-candidates') });
    if (candidate !== dist) await cp(candidate, startup, { recursive: true }); starts[name] = startup;
  };
  await savePair('P11', dist);
  async function candidate(name, code, config, suffix = '', invalidConfig = false) {
    let source = system.replace('const fixtureCode = 1;', `const fixtureCode = ${code};`);
    if (name === 'bad-commit') source = source.replace(/}\s*$/, '  override FixtureCommitGuard(): number { return 1; }\n}\n');
    await writeFile(systemPath, source + suffix);
    const data = rules(config); if (invalidConfig) data.rules[0].cost = -1;
    await writeFile(dataPath, JSON.stringify(data));
    await tool('codegen_module_configs.mjs');
    const output = await tool('build_runtime_bundles.mjs', ['--out-dir', dist, '--hotfix-only']);
    const built = immutableCandidateFromOutput(output, 'hotfix', dist);
    await savePair(name, built);
  }
  for (const [name, code, config] of [['P21', 2, 1], ['P12', 1, 2], ['P22', 2, 2]]) await candidate(name, code, config);
  await candidate('bad-evaluation', 2, 2, '\nthrow new Error("isolated candidate evaluation failure");\n');
  // 故障副本故意破坏完整性，不修改任何正式生成源或已发布候选。 / Corrupt only an isolated fault copy, never generated source or published candidates.
  pairs['bad-hash'] = path.join(directory, 'pairs/bad-hash'); await cp(pairs.P22, pairs['bad-hash'], { recursive: true });
  await writeFile(path.join(pairs['bad-hash'], 'game-config/game-config.manifest.json'), '{}');
  await candidate('bad-config', 2, 2, '', true);
  await candidate('bad-commit', 2, 2);
  await writeFile(systemPath, system); await writeFile(dataPath, JSON.stringify(rules(1)));
  const modelPath = path.join(module, 'src/model/SlgWorldScene.ts'), model = await readFile(modelPath, 'utf8');
  const residencyPath = path.join(module, 'src/model/residency.json'), residency = await readFile(residencyPath, 'utf8');
  for (const kind of ['model', 'protocol', 'cold', 'schema']) {
    if (kind === 'model') await writeFile(modelPath, replaceOnce(model, 'durable = false;', 'durable = false; fixtureExtra = 0;'));
    if (kind === 'protocol') { await writeFile(systemPath, system.replace('return { fixtureCode,', 'return { incompatibleExtra: 0, fixtureCode,')); await writeFile(protoPath, proto.replace('  uint32 fixture_duration = 22;', '  uint32 fixture_duration = 22;\n  uint32 incompatible_extra = 23;')); await tool('codegen_module_protocol.mjs', ['--update-locks']); }
    if (kind === 'cold') await writeFile(residencyPath, replaceOnce(residency, '300000', '300001'));
    if (kind === 'schema') {
      await writeFile(schemaPath, replaceOnce(schema, '</bean>', '<var name="incompatible" type="int"/></bean>'));
      const data = rules(1); data.rules[0].incompatible = 0; await writeFile(dataPath, JSON.stringify(data));
    }
    const output = path.join(directory, `incompatible-${kind}`);
    await tool('codegen_module_configs.mjs');
    await tool('build_runtime_bundles.mjs', ['--out-dir', output]); pairs[`bad-${kind}`] = output;
    await writeFile(systemPath, system); await writeFile(modelPath, model); await writeFile(residencyPath, residency); await writeFile(schemaPath, schema); await writeFile(dataPath, JSON.stringify(rules(1)));
    if (kind === 'protocol') { await writeFile(protoPath, proto); await tool('codegen_module_protocol.mjs', ['--update-locks']); }
  }
  await tool('codegen_module_configs.mjs'); await tool('typecheck_game_modules.mjs');
  const require = createRequire(path.join(engine, 'package.json'));
  const client = path.join(directory, 'client.mjs');
  await require('esbuild').build({ entryPoints: [path.join(root, 'tools/acceptance/hotfix-client.ts')], outfile: client, bundle: true, format: 'esm', platform: 'node', alias: { '#fixture': path.join(module, 'generated/typescript') } });
  const identities = {}, configFingerprints = {};
  for (const [name, dir] of Object.entries(pairs)) identities[name] = JSON.parse(await readFile(path.join(dir, 'hotfix.manifest.json'), 'utf8'));
  for (const name of ['P11', 'P21', 'P12', 'P22']) {
    const cm = JSON.parse(await readFile(path.join(pairs[name], 'game-config/game-config.manifest.json'), 'utf8'));
    configFingerprints[name] = JSON.parse(cm.moduleConfigsJson)[0].dataFingerprint;
    for (const field of ['modelFingerprint', 'modelSourceHash', 'protocolFingerprint', 'gameConfigSchemaFingerprint']) assert.equal(identities[name][field], identities.P11[field], field);
  }
  assert.equal(new Set(['P11', 'P21', 'P12', 'P22'].map(name => identities[name].releaseId)).size, 4);
  assert.equal(configFingerprints.P11, configFingerprints.P21); assert.equal(configFingerprints.P12, configFingerprints.P22);
  assert.notEqual(configFingerprints.P11, configFingerprints.P22);
  for (const [name, field] of [['model', 'modelSourceHash'], ['protocol', 'protocolFingerprint'], ['cold', 'modelSourceHash'], ['schema', 'modelSourceHash']]) assert.notEqual(identities['bad-' + name][field], identities.P11[field], name);
  const moduleSchema = async name => JSON.parse(JSON.parse(await readFile(path.join(pairs[name], 'game-config/game-config.manifest.json'), 'utf8')).moduleConfigsJson)[0].schemaFingerprint;
  assert.notEqual(await moduleSchema('bad-schema'), await moduleSchema('P11'));
  return { pairs, starts, client, identities, configFingerprints, files: await treeHashes(directory), directory, rpcTimeoutMs: 30000, dbTimeoutMs: 5000, reloadTimeoutMs: 3000 };
}
