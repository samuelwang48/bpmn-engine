'use strict';

const Bpmn = require('../..');
const Code = require('code');
const Lab = require('lab');
const nock = require('nock');
const testHelpers = require('../helpers/testHelpers');

const lab = exports.lab = Lab.script();
const expect = Code.expect;


lab.experiment('ScriptTask', () => {
  lab.describe('ctor', () => {
    lab.test('should have inbound and outbound sequence flows', (done) => {
      const processXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
          <startEvent id="theStart" />
          <scriptTask id="scriptTask" scriptFormat="Javascript">
            <script>
              <![CDATA[
                next(null, {input: 2});
              ]]>
            </script>
          </scriptTask>
          <endEvent id="theEnd" />
          <sequenceFlow id="flow1" sourceRef="theStart" targetRef="scriptTask" />
          <sequenceFlow id="flow2" sourceRef="scriptTask" targetRef="theEnd" />
        </process>
      </definitions>`;

      testHelpers.getContext(processXml, (cerr, context) => {
        if (cerr) return done(cerr);
        const task = context.getChildActivityById('scriptTask');
        expect(task).to.include('inbound');
        expect(task.inbound).to.have.length(1);
        expect(task).to.include('outbound');
        expect(task.outbound).to.have.length(1);
        done();
      });
    });

    lab.test('is considered end if without outbound sequenceFlows', (done) => {
      const alternativeProcessXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
        <scriptTask id="scriptTask" scriptFormat="Javascript">
          <script>
            <![CDATA[
              this.context.input = 2;
              next();
            ]]>
          </script>
        </scriptTask>
        </process>
      </definitions>`;

      testHelpers.getContext(alternativeProcessXml, (cerr, context) => {
        if (cerr) return done(cerr);
        const task = context.getChildActivityById('scriptTask');
        expect(task.isEnd).to.be.true();
        done();
      });
    });
  });

  lab.experiment('execution', () => {
    lab.test('executes script', (done) => {
      const processXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
          <startEvent id="theStart" />
          <scriptTask id="scriptTask" scriptFormat="Javascript">
            <script>
              <![CDATA[
                next(null, {input: this.variables.input});
              ]]>
            </script>
          </scriptTask>
          <endEvent id="theEnd" />
          <sequenceFlow id="flow1" sourceRef="theStart" targetRef="scriptTask" />
          <sequenceFlow id="flow2" sourceRef="scriptTask" targetRef="theEnd" />
        </process>
      </definitions>`;

      testHelpers.getContext(processXml, (cerr, context) => {
        if (cerr) return done(cerr);
        context.variablesAndServices.variables.input = 1;

        const task = context.getChildActivityById('scriptTask');
        task.activate();

        task.once('end', (activity, output) => {
          expect(output).to.equal({input: 1});
          done();
        });

        task.inbound[0].take();
      });
    });

    lab.test('emits error if returned in next function', (done) => {
      const processXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <process id="theProcess" isExecutable="true">
        <startEvent id="theStart" />
        <scriptTask id="scriptTask" scriptFormat="Javascript">
          <script>
            <![CDATA[
              next(new Error('Inside'));
            ]]>
          </script>
        </scriptTask>
        <endEvent id="theEnd" />
        <sequenceFlow id="flow1" sourceRef="theStart" targetRef="scriptTask" />
        <sequenceFlow id="flow2" sourceRef="scriptTask" targetRef="theEnd" />
        </process>
      </definitions>`;

      testHelpers.getContext(processXml, (cerr, context) => {
        if (cerr) return done(cerr);
        const task = context.getChildActivityById('scriptTask');

        task.once('error', (e, tsk) => {
          expect(e).to.exist();
          expect(e).to.be.an.error(Error, 'Inside');
          expect(tsk).to.include({id: 'scriptTask'});
          done();
        });

        task.run();
      });
    });

    lab.test('can access services', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<process id="theProcess" isExecutable="true">
<startEvent id="theStart" />
<scriptTask id="scriptTask" scriptFormat="Javascript">
  <script>
    <![CDATA[
      const request = services.request;

      const self = this;

      request.get('http://example.com/test', (err, resp, body) => {
        if (err) return next(err);
        next(null, JSON.parse(body));
      })
    ]]>
  </script>
</scriptTask>
<endEvent id="theEnd" />
<sequenceFlow id="flow1" sourceRef="theStart" targetRef="scriptTask" />
<sequenceFlow id="flow2" sourceRef="scriptTask" targetRef="theEnd" />
</process>
</definitions>`;

      nock('http://example.com')
        .get('/test')
        .reply(200, {
          data: 2
        });

      testHelpers.getContext(processXml, (cerr, context) => {
        if (cerr) return done(cerr);

        context.variablesAndServices.services = {
          request: {
            module: 'request'
          }
        };

        const task = context.getChildActivityById('scriptTask');
        task.activate();

        task.once('end', (t, output) => {
          expect(output).to.include({
            data: 2
          });
          done();
        });

        task.inbound[0].take();
      });
    });

    lab.test('and even require', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<process id="theProcess" isExecutable="true">
<startEvent id="theStart" />
<scriptTask id="scriptTask" scriptFormat="Javascript">
  <script>
    <![CDATA[
      const require = services.require;
      const request = require('request');

      const self = this;

      request.get('http://example.com/test', (err, resp, body) => {
        if (err) return next(err);
        next(null, JSON.parse(body));
      })
    ]]>
  </script>
</scriptTask>
<endEvent id="theEnd" />
<sequenceFlow id="flow1" sourceRef="theStart" targetRef="scriptTask" />
<sequenceFlow id="flow2" sourceRef="scriptTask" targetRef="theEnd" />
</process>
</definitions>`;

      nock('http://example.com')
        .get('/test')
        .reply(200, {
          data: 3
        });

      testHelpers.getContext(processXml, (cerr, context) => {
        if (cerr) return done(cerr);

        context.variablesAndServices = {
          services: {
            require: {
              module: 'require',
              type: 'global'
            }
          },
          variables: {
            data: 1
          }
        };

        const task = context.getChildActivityById('scriptTask');
        task.activate();

        task.once('end', (t, output) => {
          expect(output).to.include({
            data: 3
          });
          done();
        });

        task.inbound[0].take();
      });
    });

    lab.test('service function name', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<process id="theProcess" isExecutable="true">
<startEvent id="theStart" />
<scriptTask id="scriptTask" scriptFormat="Javascript">
  <script>
    <![CDATA[
      const self = this;
      services.get('http://example.com/test', {json: true}, (err, resp, body) => {
        if (err) return next(err);
        next(null, body);
      })
    ]]>
  </script>
</scriptTask>
<endEvent id="theEnd" />
<sequenceFlow id="flow1" sourceRef="theStart" targetRef="scriptTask" />
<sequenceFlow id="flow2" sourceRef="scriptTask" targetRef="theEnd" />
</process>
</definitions>`;

      nock('http://example.com')
        .defaultReplyHeaders({
          'Content-Type': 'application/json'
        })
        .get('/test')
        .reply(200, {
          data: 4
        });

      testHelpers.getContext(processXml, (cerr, context) => {
        if (cerr) return done(cerr);

        context.variablesAndServices = {
          services: {
            get: {
              module: 'request',
              type: 'require',
              fnName: 'get'
            }
          },
          variables: {
            data: 1
          }
        };

        const task = context.getChildActivityById('scriptTask');
        task.activate();

        task.once('end', (t, output) => {
          expect(nock.isDone()).to.be.true();
          expect(output).to.include({
            data: 4
          });
          done();
        });

        task.inbound[0].take();
      });
    });

    lab.test('output can be used for subsequent decisions', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<process id="theProcess" isExecutable="true">
<startEvent id="start" />
<exclusiveGateway id="decision" default="flow4" />
<scriptTask id="scriptTask" scriptFormat="Javascript">
  <script>
    <![CDATA[
      this.variables.stopLoop = true;
      next();
    ]]>
  </script>
</scriptTask>
<endEvent id="end" />
<sequenceFlow id="flow1" sourceRef="start" targetRef="decision" />
<sequenceFlow id="flow2" sourceRef="decision" targetRef="scriptTask">
  <conditionExpression xsi:type="tFormalExpression" language="JavaScript"><![CDATA[
  !this.variables.stopLoop
  ]]></conditionExpression>
</sequenceFlow>
<sequenceFlow id="flow3" sourceRef="scriptTask" targetRef="decision" />
<sequenceFlow id="flow4" sourceRef="decision" targetRef="end" />
</process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml
      });
      engine.execute((err, execution) => {
        if (err) return done(err);
        execution.once('end', () => {
          expect(nock.isDone()).to.be.true();
          done();
        });
      });
    });
  });

  lab.describe('output', () => {
    lab.test('is passed by callback', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <process id="theProcess" isExecutable="true">
    <scriptTask id="scriptTask" scriptFormat="Javascript">
      <script>
        <![CDATA[
          this.variables.stopLoop = true;
          next(null, {output: 1});
        ]]>
      </script>
    </scriptTask>
  </process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml
      });
      engine.execute((err, execution) => {
        if (err) return done(err);
        execution.once('end', () => {
          expect(execution.variables.taskInput.scriptTask.output).to.equal(1);
          done();
        });
      });
    });

    lab.test('with output parameters returns formatted output', (done) => {
      const processXml = `
<definitions id="Definitions_1" xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Camunda Modeler" exporterVersion="1.6.0">
  <process id="Process_1" isExecutable="true">
    <scriptTask id="scriptTask" name="Execute" scriptFormat="JavaScript">
      <extensionElements>
        <camunda:inputOutput>
          <camunda:inputParameter name="apiPath">\${variables.apiPath}</camunda:inputParameter>
          <camunda:inputParameter name="input">\${variables.input}</camunda:inputParameter>
          <camunda:inputParameter name="path">/api/v8</camunda:inputParameter>
          <camunda:outputParameter name="calledApi">\${api}</camunda:outputParameter>
          <camunda:outputParameter name="result"></camunda:outputParameter>
        </camunda:inputOutput>
      </extensionElements>
      <incoming>SequenceFlow_1jgxkq2</incoming>
      <outgoing>SequenceFlow_040np9m</outgoing>
      <script><![CDATA[
      next(null, {
        api: apiPath + path,
        result: input
      })]]></script>
    </scriptTask>
  </process>
</definitions>
        `;
      testHelpers.getContext(processXml, {
        camunda: require('camunda-bpmn-moddle/resources/camunda')
      }, (err, localContext) => {
        if (err) return done(err);

        localContext.variables = {
          apiPath: 'http://example-2.com',
          input: 8
        };

        const task = localContext.getChildActivityById('scriptTask');

        task.once('end', (activity, output) => {
          expect(output).to.equal({
            calledApi: 'http://example-2.com/api/v8',
            result: 8
          });
          done();
        });

        task.run();
      });
    });
  });

  lab.describe('loop', () => {
    lab.describe('sequential', () => {
      let context;
      lab.beforeEach((done) => {
        getLoopContext(true, (err, result) => {
          if (err) return done(err);
          context = result;
          done();
        });
      });

      lab.test('emits start with task id', (done) => {
        const task = context.getChildActivityById('task');
        task.activate();
        const starts = [];
        task.on('start', (activity) => {
          starts.push(activity.id);
        });

        task.once('end', () => {
          expect(starts).to.equal(['task', 'task', 'task']);
          done();
        });

        task.run();
      });

      lab.test('emits end with output', (done) => {
        const task = context.getChildActivityById('task');
        task.activate();

        task.once('end', (t, output) => {
          expect(output).to.equal(['Pål', 'Franz', 'Immanuel']);
          done();
        });

        task.run();
      });

      lab.test('getOutput() returns result from loop', (done) => {
        const task = context.getChildActivityById('task');
        task.activate();

        task.once('end', () => {
          expect(task.getOutput()).to.equal(['Pål', 'Franz', 'Immanuel']);
          done();
        });

        task.run();
      });

    });

    lab.describe('parallell', () => {
      let context;
      lab.beforeEach((done) => {
        getLoopContext(false, (err, result) => {
          if (err) return done(err);
          context = result;
          done();
        });
      });

      lab.test('emits start with different ids', (done) => {
        const task = context.getChildActivityById('task');
        task.activate();

        const starts = [];
        task.on('start', (activity) => {
          starts.push(activity.id);
        });

        task.once('end', () => {
          expect(starts.includes(task.id), 'unique task id').to.be.false();
          done();
        });

        task.run();
      });

      lab.test('returns output in sequence', (done) => {
        const task = context.getChildActivityById('task');
        task.activate();

        task.once('end', () => {
          expect(task.getOutput()).to.equal(['Pål', 'Franz', 'Immanuel']);
          done();
        });

        task.run();
      });

      lab.test('getOutput() returns result from loop', (done) => {
        const task = context.getChildActivityById('task');
        task.activate();

        task.once('end', () => {
          expect(task.getOutput()).to.equal(['Pål', 'Franz', 'Immanuel']);
          done();
        });

        task.run();
      });
    });
  });

});

function getLoopContext(sequential, callback) {
  const processXml = `
  <?xml version="1.0" encoding="UTF-8"?>
  <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
    <process id="sequentialLoopProcess" isExecutable="true">
      <scriptTask id="task" scriptFormat="javascript">
        <multiInstanceLoopCharacteristics isSequential="${sequential}" camunda:collection="\${variables.names}">
          <loopCardinality>5</loopCardinality>
        </multiInstanceLoopCharacteristics>
        <extensionElements>
          <camunda:inputOutput>
            <camunda:inputParameter name="invertTimout">\${index}</camunda:inputParameter>
            <camunda:inputParameter name="name">\${item}</camunda:inputParameter>
            <camunda:inputParameter name="setTimeout">\${services.setTimeout}</camunda:inputParameter>
          </camunda:inputOutput>
        </extensionElements>
        <script><![CDATA[
          setTimeout(next, 50 - invertTimout * 10, null, name);
        ]]></script>
      </scriptTask>
    </process>
  </definitions>`;
  testHelpers.getContext(processXml, {
    camunda: require('camunda-bpmn-moddle/resources/camunda')
  }, (err, context) => {
    if (err) return callback(err);

    context.variablesAndServices.variables.names = ['Pål', 'Franz', 'Immanuel'];
    context.variablesAndServices.services.setTimeout = setTimeout;

    return callback(null, context);
  });
}

