// 测试显式组合宿主与模块身份；生产模块仍使用自己的直接依赖入口。
// Tests explicitly compose host and module identities; production modules use dependency APIs.
export * from "../../../TiangZ/app/model/public";
export * from "../../modules/mmorpg/src/model/public";
export { NumericType, AllNumericTypes } from "../../modules/mmorpg/src/model/public";
