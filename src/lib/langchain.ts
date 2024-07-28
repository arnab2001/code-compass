import {
  experimental_StreamData,
  LangChainStream,
  StreamingTextResponse,
} from 'ai-stream-experimental';
import { ConversationalRetrievalQAChain } from 'langchain/chains';

import { nonStreamingModel, streamingModel } from './llm';
import { getPineconeClient } from './pinecone-client';
import { QA_TEMPLATE, STANDALONE_QUESTION_TEMPLATE } from './prompt-templates';
import { getVectorStore } from './vector-store';

type callChainArgs = {
  question: string;
  chatHistory: string;
  indexname: string;
};

export async function callChain({
  question,
  chatHistory,
  indexname,
}: callChainArgs) {
  try {
    // Open AI recommendation
    const sanitizedQuestion = question.trim().replaceAll('\n', ' ');
    const pineconeClient = await getPineconeClient();
    const vectorStore = await getVectorStore(pineconeClient, indexname);
    // const retriever = vectorStore.asRetriever({
    //   searchKwargs: { k: 5 },  // Increase from default 4 to 5
    //   searchType: "mmr",  // Use Maximum Marginal Relevance for diverse results
    //   filter: { type: "code" }  // Add a filter if you've categorized your embeddings
    // });
    const { stream, handlers } = LangChainStream({
      experimental_streamData: true,
    });
    const data = new experimental_StreamData();

    const chain = ConversationalRetrievalQAChain.fromLLM(
      streamingModel,
      vectorStore.asRetriever(),
      {
        qaTemplate: QA_TEMPLATE,
        questionGeneratorTemplate: STANDALONE_QUESTION_TEMPLATE,
        returnSourceDocuments: true, //default 4
        questionGeneratorChainOptions: {
          llm: nonStreamingModel,
        },
      }
    );

    // Question using chat-history
    // Reference https://js.langchain.com/docs/modules/chains/popular/chat_vector_db#externally-managed-memory
    chain
      .call(
        {
          question: sanitizedQuestion,
          chat_history: chatHistory,
        },
        [handlers]
      )
      .then(async (res) => {
        const sourceDocuments = res?.sourceDocuments;
        const firstTwoDocuments = sourceDocuments.slice(0, 2);
        const pageContents = firstTwoDocuments.map(
          ({ pageContent }: { pageContent: string }) => pageContent
        );
        console.log('already appended ', data);
        data.append({
          sources: pageContents,
        });
        data.close();
      });

    // Return the readable stream
    return new StreamingTextResponse(stream, {}, data);
  } catch (e) {
    console.error(e);
    throw new Error('Call chain method failed to execute successfully!!');
  }
}
