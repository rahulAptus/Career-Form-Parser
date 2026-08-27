/**
 * Controlled skills vocabulary.
 *
 * This is deliberately a closed list rather than open-ended keyword mining.
 * Because Aptus owns the vocabulary, every value the parser emits is already a
 * legal HubSpot dropdown option — no cleanup step, no "Node.js" vs "NodeJS"
 * vs "node" splitting one skill into three filter values.
 *
 * Adding a skill: put the HubSpot-facing name first, then every spelling you
 * expect to see on a resume. Aliases are matched case-insensitively on word
 * boundaries, so short ones ("R", "Go") need care — see EXACT_CASE below.
 */

export const SKILLS = {
  // --- Data engineering -------------------------------------------------
  'Spark':            ['spark', 'apache spark', 'pyspark', 'spark sql'],
  'Databricks':       ['databricks', 'delta lake', 'unity catalog'],
  'Snowflake':        ['snowflake'],
  'Airflow':          ['airflow', 'apache airflow', 'mwaa'],
  'dbt':              ['dbt', 'data build tool'],
  'Kafka':            ['kafka', 'apache kafka', 'confluent'],
  'Hadoop':           ['hadoop', 'hdfs', 'hive', 'mapreduce'],
  'ETL':              ['etl', 'elt', 'data pipeline', 'data pipelines', 'ingestion pipeline'],
  'Lakehouse':        ['lakehouse', 'data lakehouse', 'medallion architecture'],
  'Data Modelling':   ['data modelling', 'data modeling', 'dimensional modelling', 'dimensional modeling', 'star schema'],
  'Data Governance':  ['data governance', 'data quality', 'data lineage', 'master data management', 'mdm'],

  // --- AI / ML ----------------------------------------------------------
  'Machine Learning': ['machine learning', 'ml', 'supervised learning', 'unsupervised learning'],
  'Deep Learning':    ['deep learning', 'neural network', 'neural networks', 'cnn', 'rnn', 'transformer'],
  'NLP':              ['nlp', 'natural language processing', 'text mining'],
  'Computer Vision':  ['computer vision', 'opencv', 'image recognition'],
  'Generative AI':    ['generative ai', 'genai', 'gen ai', 'llm', 'llms', 'large language model', 'large language models'],
  'Agentic AI':       ['agentic ai', 'ai agents', 'agent framework', 'langgraph', 'autogen', 'crewai'],
  'RAG':              ['rag', 'retrieval augmented generation', 'retrieval-augmented generation', 'vector search'],
  'LLMOps':           ['llmops', 'prompt engineering', 'model evaluation', 'guardrails'],
  'MLOps':            ['mlops', 'mlflow', 'kubeflow', 'model deployment', 'model monitoring', 'feature store'],
  'Responsible AI':   ['responsible ai', 'ai governance', 'model explainability', 'explainable ai', 'xai', 'bias detection'],
  'PyTorch':          ['pytorch', 'torch'],
  'TensorFlow':       ['tensorflow', 'keras'],
  'scikit-learn':     ['scikit-learn', 'scikit learn', 'sklearn'],
  'LangChain':        ['langchain', 'llamaindex', 'llama index'],
  'Vector Databases': ['pinecone', 'weaviate', 'chroma', 'chromadb', 'qdrant', 'milvus', 'faiss', 'vector database', 'vector db'],

  // --- Cloud & platform -------------------------------------------------
  'AWS':              ['aws', 'amazon web services', 's3', 'ec2', 'lambda', 'redshift', 'sagemaker', 'glue'],
  'Azure':            ['azure', 'microsoft azure', 'azure data factory', 'adf', 'synapse', 'azure ml'],
  'GCP':              ['gcp', 'google cloud', 'bigquery', 'vertex ai', 'dataflow'],
  'Kubernetes':       ['kubernetes', 'k8s', 'eks', 'aks', 'gke', 'helm'],
  'Docker':           ['docker', 'containerisation', 'containerization', 'containers'],
  'Terraform':        ['terraform', 'infrastructure as code', 'iac', 'cloudformation', 'pulumi'],
  'CI/CD':            ['ci/cd', 'cicd', 'continuous integration', 'continuous deployment', 'jenkins', 'github actions', 'gitlab ci'],
  'Linux':            ['linux', 'unix', 'bash scripting', 'shell scripting'],

  // --- Languages --------------------------------------------------------
  'Python':           ['python', 'python3'],
  'SQL':              ['sql', 'pl/sql', 'plsql', 't-sql', 'tsql'],
  'Java':             ['java', 'j2ee', 'spring boot', 'springboot'],
  'Go':               ['golang'],
  'JavaScript':       ['javascript', 'js', 'es6', 'ecmascript'],
  'TypeScript':       ['typescript', 'ts'],
  'Scala':            ['scala'],
  'C#':               ['c#', 'csharp', '.net', 'dotnet', 'asp.net'],
  'C++':              ['c++', 'cpp'],

  // --- Product & digital engineering ------------------------------------
  'React':            ['react', 'react.js', 'reactjs', 'next.js', 'nextjs'],
  'Angular':          ['angular', 'angularjs'],
  'Vue':              ['vue', 'vue.js', 'vuejs', 'nuxt'],
  'Node.js':          ['node.js', 'nodejs', 'express.js', 'expressjs'],
  'REST APIs':        ['rest api', 'rest apis', 'restful', 'graphql', 'grpc', 'openapi', 'swagger'],
  'Design Systems':   ['design system', 'design systems', 'storybook', 'component library'],
  'Accessibility':    ['accessibility', 'wcag', 'a11y', 'aria'],
  'UI/UX':            ['ui/ux', 'ux design', 'ui design', 'figma', 'user research', 'wireframing', 'prototyping'],

  // --- Analytics & BI ---------------------------------------------------
  'Power BI':         ['power bi', 'powerbi', 'dax'],
  'Tableau':          ['tableau'],
  'Looker':           ['looker', 'looker studio', 'data studio'],
  'Statistics':       ['statistics', 'statistical analysis', 'hypothesis testing', 'a/b testing', 'ab testing', 'regression analysis'],
  'Forecasting':      ['forecasting', 'time series', 'demand forecasting', 'arima', 'prophet'],
  'Excel':            ['excel', 'advanced excel', 'vba'],

  // --- Domain / regulated -----------------------------------------------
  'GxP':              ['gxp', 'gmp', 'glp', 'gcp compliance', '21 cfr part 11', 'csv validation'],
  'Pharmacovigilance':['pharmacovigilance', 'drug safety', 'adverse event'],
  'Clinical Data':    ['clinical data', 'clinical trial', 'cdisc', 'sdtm', 'adam'],
  'Regulatory':       ['regulatory affairs', 'regulatory compliance', 'fda submission'],
  'Banking':          ['banking', 'financial services', 'fintech', 'core banking', 'payments'],
  'Risk & Compliance':['risk management', 'aml', 'kyc', 'basel', 'regulatory reporting'],
  'Supply Chain':     ['supply chain', 'demand planning', 'supply planning', 's&op', 'inventory optimisation', 'inventory optimization'],

  // --- Delivery & business ----------------------------------------------
  'Agile':            ['agile', 'scrum', 'kanban', 'safe', 'sprint planning'],
  'Jira':             ['jira', 'confluence', 'azure devops'],
  'Stakeholder Management': ['stakeholder management', 'client management', 'client engagement'],
  'Solution Architecture':  ['solution architecture', 'solution architect', 'enterprise architecture', 'technical architecture'],
  'Pre-sales':        ['pre-sales', 'presales', 'rfp', 'proposal writing', 'bid management'],
  'Project Management':     ['project management', 'programme management', 'program management', 'pmp', 'prince2'],
  'Alliances':        ['alliances', 'partner management', 'channel management', 'go-to-market', 'gtm'],
  'Talent Acquisition':     ['talent acquisition', 'recruitment', 'recruiting', 'sourcing', 'technical hiring'],
  'Digital Marketing':      ['digital marketing', 'seo', 'sem', 'demand generation', 'lead generation', 'content marketing']
};

/**
 * Aliases that are too short or too common to match case-insensitively —
 * matching "R" or "go" or "ts" against ordinary prose produces nothing but
 * false positives. These are matched with their exact casing instead.
 */
const EXACT_CASE = {
  'R': ['R'],
  'Go': ['Go'],
  'SAS': ['SAS'],
  'ETL': ['ETL']
};

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Alias -> canonical name, longest alias first so "apache spark" wins over
 * "spark".
 *
 * Names that also appear in EXACT_CASE are deliberately kept OUT of this
 * case-insensitive index. They are in EXACT_CASE precisely because loose
 * matching misfires on them — indexing "go" here as well would hand "Go" back
 * to the permissive path and undo that, which is how "Go-to-market" was being
 * read as the Go language. Their explicit aliases (golang, etl) still match
 * case-insensitively; only the bare canonical name is restricted.
 */
const ALIAS_INDEX = (() => {
  const pairs = [];
  for (const [canonical, aliases] of Object.entries(SKILLS)) {
    if (!(canonical in EXACT_CASE)) pairs.push([canonical.toLowerCase(), canonical]);
    for (const alias of aliases) pairs.push([alias.toLowerCase(), canonical]);
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
})();

const boundary = alias => {
  // \b does not fire next to +, # or . — the characters that end half our
  // language names — so those need an explicit lookaround instead.
  const start = /^[a-z0-9]/i.test(alias) ? '(?<![a-z0-9])' : '(?<![a-z0-9+#.])';
  const end = /[a-z0-9]$/i.test(alias) ? '(?![a-z0-9])' : '(?![a-z0-9+#.])';
  return new RegExp(start + escape(alias) + end, 'i');
};

/**
 * @param {string} sectionText  text of the skills section, if one was found
 * @param {string} allText      the whole resume
 * @returns {{name: string, inSkillsSection: boolean, matchedOn: string}[]}
 *          sorted with skills-section hits first
 */
export function matchSkills(sectionText = '', allText = '') {
  const found = new Map();

  for (const [alias, canonical] of ALIAS_INDEX) {
    if (found.has(canonical)) continue;
    const re = boundary(alias);
    if (sectionText && re.test(sectionText)) {
      found.set(canonical, { name: canonical, inSkillsSection: true, matchedOn: alias });
    } else if (re.test(allText)) {
      found.set(canonical, { name: canonical, inSkillsSection: false, matchedOn: alias });
    }
  }

  for (const [canonical, aliases] of Object.entries(EXACT_CASE)) {
    if (found.has(canonical)) continue;
    for (const alias of aliases) {
      // A hyphen on either side means this is part of a compound word, not the
      // term itself — "Go-to-market" is not the Go language, and "R-squared"
      // is not R. Short exact-case terms are the only ones this can bite.
      const re = new RegExp('(?<![A-Za-z0-9-])' + escape(alias) + '(?![A-Za-z0-9-])');
      if (sectionText && re.test(sectionText)) {
        found.set(canonical, { name: canonical, inSkillsSection: true, matchedOn: alias });
        break;
      }
    }
  }

  return [...found.values()].sort((a, b) =>
    (b.inSkillsSection ? 1 : 0) - (a.inSkillsSection ? 1 : 0) || a.name.localeCompare(b.name));
}

/**
 * Every canonical name — used to generate the HubSpot multi-select options.
 *
 * Deduplicated: a name can legitimately appear in both maps (`Go` is matched
 * case-insensitively as "golang" in SKILLS and case-sensitively as "Go" in
 * EXACT_CASE), and HubSpot rejects a property whose option labels repeat.
 */
export const canonicalSkills = () =>
  [...new Set([...Object.keys(SKILLS), ...Object.keys(EXACT_CASE)])].sort();
