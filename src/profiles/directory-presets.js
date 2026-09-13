const entry = (path, purpose) => ({ path, purpose });

export function directoryEntries(project) {
  if (project.stack === 'java') return {
    source: entry('src/main/java', 'Java 生产源码根目录。'),
    tests: entry('src/test/java', 'Java 测试源码。'),
    resources: entry('src/main/resources', '运行配置与静态资源。'),
    testResources: entry('src/test/resources', '测试配置与测试数据。'),
    packages: entry('${source}', '业务包根目录；有组织包前缀时修改此路径。'),
    controller: entry('${packages}/controller', '请求入口、协议参数与响应处理。'),
    service: entry('${packages}/service', '业务流程与服务实现。'),
    repository: entry('${packages}/repository', '数据访问。'),
    dto: entry('${packages}/dto', '数据传输结构。'),
    config: entry('${packages}/config', '框架与应用装配配置。'),
    utils: entry('${packages}/utils', '公共方法。'),
    output: entry('target', '构建产物与工具生成报告。'),
    docs: entry('docs', '项目说明与维护文档。'),
  };
  const common = {
    source: entry('src', '应用源码。'),
    tests: entry(project.role === 'frontend' ? '${source}/tests' : 'test', '测试代码和测试夹具。'),
    utils: entry('${source}/utils', '公共方法。'),
    types: entry('${source}/types', '共享类型声明。'),
    config: entry('${source}/config', '应用配置与装配。'),
    output: entry('dist', '构建产物。'),
    coverage: entry('coverage', '覆盖率报告。'),
    reports: entry('reports', '其他检查报告。'),
    docs: entry('docs', '项目说明与维护文档。'),
  };
  if (project.role === 'backend') return { ...common,
    controller: entry('${source}/controllers', '请求入口、协议参数与响应处理。'),
    service: entry('${source}/services', '业务流程与服务实现。'),
    repository: entry('${source}/repositories', '数据访问。'),
    middleware: entry('${source}/middleware', '请求处理公共中间件。'),
  };
  return { ...common,
    utilityTests: entry('${tests}/utils', '公共方法对应的测试。'),
    styles: entry('styles', '共享样式与设计变量。'),
    assets: entry('${source}/assets', '源码引用的静态资源。'),
    public: entry('public', '直接发布的公共资源。'),
    components: entry('${source}/components', '可复用界面组件。'),
    pages: entry('${source}/pages', '路由页面。'),
    views: entry('${source}/views', '页面视图。'),
    composables: entry('${source}/composables', '可复用组合逻辑。'),
    api: entry('${source}/api', '接口调用。'),
    stores: entry('${source}/stores', '共享应用状态。'),
    store: entry('${source}/store', '单目录状态模块。'),
    features: entry('${source}/features', '按业务组织的模块。'),
    shared: entry('${source}/shared', '跨业务共享实现。'),
    constants: entry('${source}/constants', '共享常量。'),
  };
}
