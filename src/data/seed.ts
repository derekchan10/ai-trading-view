import type { AppState, SymbolItem, Tag } from '../types';

const positionTagIds = [
  'compute_chip',
  'semi_manufacturing_equipment',
  'hbm_storage',
  'optical_components',
  'ai_server',
  'network_dci',
  'power_liquid_dc_infra',
  'gpu_cloud_rental',
  'cloud_model_platform',
  'ai_software_agent_data',
  'ai_cybersecurity',
  'edge_ai_robotics',
];

export const seedTags: Tag[] = [
  { id: 'stage_upstream', name: '上游', category: '产业链阶段', color: '#14b8a6' },
  { id: 'stage_midstream', name: '中游', category: '产业链阶段', color: '#2563eb' },
  { id: 'stage_downstream', name: '下游', category: '产业链阶段', color: '#8b5cf6' },
  { id: 'compute_chip', name: '算力芯片', category: '产业链环节', color: '#ef4444' },
  { id: 'semi_manufacturing_equipment', name: '半导体制造与设备', category: '产业链环节', color: '#a855f7' },
  { id: 'hbm_storage', name: 'HBM / 存储', category: '产业链环节', color: '#06b6d4' },
  { id: 'optical_components', name: '光模块 / 光器件', category: '产业链环节', color: '#0ea5e9' },
  { id: 'ai_server', name: 'AI 服务器', category: '产业链环节', color: '#f97316' },
  { id: 'network_dci', name: '网络 / 交换机 / 数据中心互联', category: '产业链环节', color: '#22c55e' },
  { id: 'power_liquid_dc_infra', name: '电力 / 液冷 / 数据中心基础设施', category: '产业链环节', color: '#84cc16' },
  { id: 'gpu_cloud_rental', name: 'GPU 云 / 算力租赁', category: '产业链环节', color: '#ff2b2b' },
  { id: 'cloud_model_platform', name: '云厂商 / 大模型平台', category: '产业链环节', color: '#6366f1' },
  { id: 'ai_software_agent_data', name: 'AI 软件 / Agent / 数据平台', category: '产业链环节', color: '#ec4899' },
  { id: 'ai_cybersecurity', name: 'AI 网络安全', category: '产业链环节', color: '#f59e0b' },
  { id: 'edge_ai_robotics', name: '端侧 AI / 自动驾驶 / 机器人', category: '产业链环节', color: '#10b981' },
];

const S = {
  upstream: 'stage_upstream',
  midstream: 'stage_midstream',
  downstream: 'stage_downstream',
} as const;

const P = {
  computeChip: 'compute_chip',
  semiManufacturingEquipment: 'semi_manufacturing_equipment',
  hbmStorage: 'hbm_storage',
  opticalComponents: 'optical_components',
  aiServer: 'ai_server',
  networkDci: 'network_dci',
  powerLiquidDcInfra: 'power_liquid_dc_infra',
  gpuCloudRental: 'gpu_cloud_rental',
  cloudModelPlatform: 'cloud_model_platform',
  aiSoftwareAgentData: 'ai_software_agent_data',
  aiCybersecurity: 'ai_cybersecurity',
  edgeAiRobotics: 'edge_ai_robotics',
} as const;

function stock(code: string, name: string, tagIds: string[], defaultVisible = false): SymbolItem {
  return {
    id: `us-${code.toLowerCase()}`,
    market: 'US',
    code,
    name,
    tagIds: Array.from(new Set(tagIds)),
    defaultVisible,
  };
}

export const seedSymbols: SymbolItem[] = [
  stock('NVDA', '英伟达', [S.upstream, P.computeChip, S.downstream, P.edgeAiRobotics], true),
  stock('AMD', '超威半导体', [S.upstream, P.computeChip]),
  stock('AVGO', '博通', [S.upstream, P.computeChip, S.midstream, P.networkDci]),
  stock('MRVL', '美满电子', [S.upstream, P.computeChip, S.midstream, P.networkDci]),
  stock('ARM', 'Arm', [S.upstream, P.computeChip]),
  stock('INTC', '英特尔', [S.upstream, P.computeChip]),

  stock('TSM', '台积电', [S.upstream, P.semiManufacturingEquipment], true),
  stock('ASML', '阿斯麦', [S.upstream, P.semiManufacturingEquipment]),
  stock('AMAT', '应用材料', [S.upstream, P.semiManufacturingEquipment]),
  stock('LRCX', '泛林集团', [S.upstream, P.semiManufacturingEquipment]),
  stock('KLAC', '科磊', [S.upstream, P.semiManufacturingEquipment]),
  stock('SNPS', '新思科技', [S.upstream, P.semiManufacturingEquipment]),
  stock('CDNS', '楷登电子', [S.upstream, P.semiManufacturingEquipment]),

  stock('MU', '美光科技', [S.upstream, P.hbmStorage], true),
  stock('WDC', '西部数据', [S.upstream, P.hbmStorage]),
  stock('SNDK', 'SanDisk', [S.upstream, P.hbmStorage]),
  stock('STX', '希捷科技', [S.upstream, P.hbmStorage]),

  stock('LITE', 'Lumentum', [S.upstream, P.opticalComponents]),
  stock('COHR', 'Coherent', [S.upstream, P.opticalComponents]),
  stock('AAOI', 'Applied Optoelectronics', [S.upstream, P.opticalComponents]),
  stock('FN', 'Fabrinet', [S.upstream, P.opticalComponents]),
  stock('CIEN', 'Ciena', [S.upstream, P.opticalComponents, S.midstream, P.networkDci]),

  stock('SMCI', '超微电脑', [S.midstream, P.aiServer], true),
  stock('DELL', '戴尔科技', [S.midstream, P.aiServer]),
  stock('HPE', '慧与科技', [S.midstream, P.aiServer]),
  stock('NTAP', 'NetApp', [S.midstream, P.aiServer]),
  stock('PSTG', 'Pure Storage', [S.midstream, P.aiServer]),

  stock('ANET', 'Arista Networks', [S.midstream, P.networkDci], true),
  stock('CSCO', '思科', [S.midstream, P.networkDci]),
  stock('NOK', '诺基亚', [S.midstream, P.networkDci]),

  stock('VRT', 'Vertiv', [S.midstream, P.powerLiquidDcInfra], true),
  stock('ETN', '伊顿', [S.midstream, P.powerLiquidDcInfra]),
  stock('GEV', 'GE Vernova', [S.midstream, P.powerLiquidDcInfra]),
  stock('PWR', 'Quanta Services', [S.midstream, P.powerLiquidDcInfra]),
  stock('CEG', 'Constellation Energy', [S.midstream, P.powerLiquidDcInfra]),
  stock('VST', 'Vistra', [S.midstream, P.powerLiquidDcInfra]),
  stock('EQIX', 'Equinix', [S.midstream, P.powerLiquidDcInfra]),
  stock('DLR', 'Digital Realty', [S.midstream, P.powerLiquidDcInfra]),

  stock('CORZ', 'Core Scientific', [S.midstream, P.gpuCloudRental]),
  stock('WULF', 'TeraWulf', [S.midstream, P.gpuCloudRental]),
  stock('IREN', 'IREN', [S.midstream, P.gpuCloudRental]),
  stock('CIFR', 'Cipher Mining', [S.midstream, P.gpuCloudRental]),
  stock('CLSK', 'CleanSpark', [S.midstream, P.gpuCloudRental]),
  stock('RIOT', 'Riot Platforms', [S.midstream, P.gpuCloudRental]),
  stock('MARA', 'MARA Holdings', [S.midstream, P.gpuCloudRental]),

  stock('MSFT', '微软', [S.downstream, P.cloudModelPlatform], true),
  stock('AMZN', '亚马逊', [S.downstream, P.cloudModelPlatform]),
  stock('GOOGL', 'Alphabet', [S.downstream, P.cloudModelPlatform]),
  stock('META', 'Meta', [S.downstream, P.cloudModelPlatform]),
  stock('ORCL', '甲骨文', [S.downstream, P.cloudModelPlatform]),
  stock('IBM', 'IBM', [S.downstream, P.cloudModelPlatform]),

  stock('PLTR', 'Palantir', [S.downstream, P.aiSoftwareAgentData], true),
  stock('NOW', 'ServiceNow', [S.downstream, P.aiSoftwareAgentData]),
  stock('CRM', 'Salesforce', [S.downstream, P.aiSoftwareAgentData]),
  stock('SNOW', 'Snowflake', [S.downstream, P.aiSoftwareAgentData]),
  stock('MDB', 'MongoDB', [S.downstream, P.aiSoftwareAgentData]),
  stock('DDOG', 'Datadog', [S.downstream, P.aiSoftwareAgentData]),
  stock('NET', 'Cloudflare', [S.downstream, P.aiSoftwareAgentData]),

  stock('CRWD', 'CrowdStrike', [S.downstream, P.aiCybersecurity]),
  stock('PANW', 'Palo Alto Networks', [S.downstream, P.aiCybersecurity]),
  stock('ZS', 'Zscaler', [S.downstream, P.aiCybersecurity]),
  stock('FTNT', 'Fortinet', [S.downstream, P.aiCybersecurity]),
  stock('OKTA', 'Okta', [S.downstream, P.aiCybersecurity]),
  stock('S', 'SentinelOne', [S.downstream, P.aiCybersecurity]),

  stock('TSLA', '特斯拉', [S.downstream, P.edgeAiRobotics], true),
  stock('QCOM', '高通', [S.downstream, P.edgeAiRobotics]),
  stock('MBLY', 'Mobileye', [S.downstream, P.edgeAiRobotics]),
  stock('SYM', 'Symbotic', [S.downstream, P.edgeAiRobotics]),
  stock('TER', 'Teradyne', [S.downstream, P.edgeAiRobotics]),
];

export function createInitialState(): AppState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    tags: seedTags,
    symbols: seedSymbols.map((symbol) => ({ ...symbol })),
    selectedSymbolIds: seedSymbols.map((symbol) => symbol.id),
    selectedTagIds: positionTagIds,
    mode: 'tags',
    interval: '1d',
    startDate: '2025-01-01',
    endDate: today,
  };
}
