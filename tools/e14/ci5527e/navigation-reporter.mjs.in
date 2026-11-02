import { writeFileSync } from 'node:fs';
export default class Reporter {
  onTestRunEnd(modules, errors) {
    writeFileSync(process.env.CI5527_REPORT, JSON.stringify({modules: modules.map(module => ({id: module.relativeModuleId, state: module.state(), diagnostic: module.diagnostic(), tests: Array.from(module.children.allTests(), test => ({id: test.fullName, result: test.result(), diagnostic: test.diagnostic()}))})), errors}, null, 2));
  }
}
