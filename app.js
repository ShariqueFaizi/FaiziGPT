const statusEl = document.getElementById('status');
const promptEl = document.getElementById('prompt');
const endpointEl = document.getElementById('endpoint');
const modelEl = document.getElementById('model');
const apiKeyEl = document.getElementById('api-key');
const generateBtn = document.getElementById('generate-btn');
const resetBtn = document.getElementById('reset-btn');
const exportBtn = document.getElementById('export-btn');
const downloadLink = document.getElementById('download-link');

const STORAGE_KEY = 'flowable-ai-modeler-config';

const modeler = new BpmnJS({
  container: '#canvas',
  moddleExtensions: {
    flowable: window.flowableDescriptor
  }
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#065f46';
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50) || 'process';
}

function createSkeletonXml(processName, taskNames = []) {
  const processId = `process_${slugify(processName)}`;
  const tasks = taskNames.length ? taskNames : ['Review request', 'Approve request', 'Notify requester'];

  let x = 240;
  const taskElements = tasks
    .map((task, index) => {
      const id = `Task_${index + 1}`;
      const shape = `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="130" width="120" height="80" /></bpmndi:BPMNShape>`;
      x += 170;
      return {
        xml: `<bpmn:userTask id="${id}" name="${task}" />`,
        shape,
        id
      };
    });

  const sequence = [
    { id: 'Flow_start_1', source: 'StartEvent_1', target: taskElements[0].id },
    ...taskElements.slice(0, -1).map((task, index) => ({
      id: `Flow_${index + 1}`,
      source: task.id,
      target: taskElements[index + 1].id
    })),
    { id: 'Flow_end_1', source: taskElements[taskElements.length - 1].id, target: 'EndEvent_1' }
  ];

  const edges = sequence
    .map((flow, index) => {
      const startX = index === 0 ? 186 : 360 + (index - 1) * 170;
      const endX = index === sequence.length - 1 ? x - 20 : 240 + index * 170;
      return `<bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}"><di:waypoint x="${startX}" y="170" /><di:waypoint x="${endX}" y="170" /></bpmndi:BPMNEdge>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:flowable="http://flowable.org/bpmn"
  id="Definitions_1"
  targetNamespace="http://flowable.org/processdef">
  <bpmn:process id="${processId}" name="${processName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
    ${taskElements.map((task) => task.xml).join('')}
    <bpmn:endEvent id="EndEvent_1" name="End" />
    ${sequence
      .map(
        (flow) => `<bpmn:sequenceFlow id="${flow.id}" sourceRef="${flow.source}" targetRef="${flow.target}" />`
      )
      .join('')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="150" y="152" width="36" height="36" /></bpmndi:BPMNShape>
      ${taskElements.map((task) => task.shape).join('')}
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="${x + 20}" y="152" width="36" height="36" /></bpmndi:BPMNShape>
      ${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function ensureFlowableCompliance(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Generated BPMN XML is malformed.');
  }

  const definitions = doc.documentElement;
  if (!definitions.getAttribute('xmlns:flowable')) {
    definitions.setAttribute('xmlns:flowable', 'http://flowable.org/bpmn');
  }
  if (!definitions.getAttribute('targetNamespace')) {
    definitions.setAttribute('targetNamespace', 'http://flowable.org/processdef');
  }

  const process = doc.querySelector('bpmn\\:process, process');
  if (process && !process.getAttribute('isExecutable')) {
    process.setAttribute('isExecutable', 'true');
  }

  return new XMLSerializer().serializeToString(doc);
}

function parseStepsFromPrompt(prompt) {
  return prompt
    .split(/\n|,| then | and then | -> | after /gi)
    .map((part) => part.replace(/^\d+[.)]\s*/, '').trim())
    .filter((part) => part.length > 4)
    .slice(0, 8);
}

async function requestAiXml(prompt) {
  const endpoint = endpointEl.value.trim();
  const model = modelEl.value.trim();
  const apiKey = apiKeyEl.value.trim();

  if (!endpoint || !model || !apiKey) {
    const steps = parseStepsFromPrompt(prompt);
    return createSkeletonXml(prompt.slice(0, 40), steps);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'Return only BPMN 2.0 XML. Ensure XML is Flowable-compatible, uses xmlns:flowable="http://flowable.org/bpmn", has executable process, valid sequence flows, and includes BPMN DI coordinates.'
        },
        {
          role: 'user',
          content: `Design a BPMN workflow for: ${prompt}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI request failed (${response.status})`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('AI response did not include workflow XML.');
  }

  return content.replace(/^```xml\s*/i, '').replace(/```$/, '').trim();
}

async function renderXml(xml) {
  const compliantXml = ensureFlowableCompliance(xml);
  await modeler.importXML(compliantXml);
  const canvas = modeler.get('canvas');
  canvas.zoom('fit-viewport');
}

async function init() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  endpointEl.value = saved.endpoint || '';
  modelEl.value = saved.model || '';
  apiKeyEl.value = saved.apiKey || '';

  await renderXml(createSkeletonXml('New Flowable Process'));
  setStatus('Modeler ready. Provide a prompt to generate a workflow.');
}

async function handleGenerate() {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    setStatus('Please provide a workflow prompt.', true);
    return;
  }

  generateBtn.disabled = true;
  setStatus('Generating BPMN from prompt...');

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ endpoint: endpointEl.value.trim(), model: modelEl.value.trim(), apiKey: apiKeyEl.value.trim() })
  );

  try {
    const xml = await requestAiXml(prompt);
    await renderXml(xml);
    setStatus('Workflow generated and loaded successfully.');
  } catch (error) {
    console.error(error);
    setStatus(`Generation failed: ${error.message}`, true);
  } finally {
    generateBtn.disabled = false;
  }
}

async function handleExport() {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.classList.remove('hidden');
    downloadLink.textContent = 'Download workflow.bpmn';
    setStatus('BPMN exported successfully.');
  } catch (error) {
    setStatus(`Export failed: ${error.message}`, true);
  }
}

generateBtn.addEventListener('click', handleGenerate);
resetBtn.addEventListener('click', async () => {
  await renderXml(createSkeletonXml('New Flowable Process'));
  setStatus('Diagram reset to starter Flowable process.');
});
exportBtn.addEventListener('click', handleExport);

init().catch((error) => {
  console.error(error);
  setStatus(`Initialization failed: ${error.message}`, true);
});
