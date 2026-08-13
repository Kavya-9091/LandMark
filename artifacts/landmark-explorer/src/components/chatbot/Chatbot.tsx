import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, X, Send } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  actions?: string[];
}

interface QAItem {
  question: string;
  answer: string;
  keywords: string[];
}

type DestinationGuide = {
  names: string[];
  title: string;
  places: string[];
};

type WikiSummary = {
  title: string;
  extract?: string;
  description?: string;
  coordinates?: { lat: number; lon: number };
  content_urls?: { desktop?: { page?: string } };
};

const DESTINATION_GUIDES: DestinationGuide[] = [
  {
    names: ['singapore'],
    title: 'Singapore',
    places: [
      'Marina Bay Sands and SkyPark',
      'Gardens by the Bay',
      'Sentosa Island',
      'Universal Studios Singapore',
      'Merlion Park',
      'Singapore Flyer',
      'Chinatown',
      'Little India',
      'Clarke Quay',
      'Singapore Botanic Gardens',
      'Jewel Changi Airport',
      'Night Safari',
    ],
  },
  {
    names: ['usa', 'america', 'united states', 'united states of america', 'u.s.', 'us trip'],
    title: 'USA',
    places: [
      'Statue of Liberty and Times Square in New York City',
      'White House, National Mall, and Smithsonian museums in Washington, DC',
      'Grand Canyon in Arizona',
      'Golden Gate Bridge and Alcatraz Island in San Francisco',
      'Hollywood and Disneyland in California',
      'Las Vegas Strip and Hoover Dam',
      'Walt Disney World and Miami Beach in Florida',
      'Yellowstone National Park',
      'Niagara Falls',
      'Chicago Millennium Park',
    ],
  },
  {
    names: ['india'],
    title: 'India',
    places: [
      'Taj Mahal in Agra',
      'Jaipur City Palace and Hawa Mahal',
      'Red Fort and India Gate in Delhi',
      'Varanasi ghats',
      'Goa beaches',
      'Kerala backwaters',
      'Mysore Palace',
      'Gateway of India in Mumbai',
      'Hampi',
      'Golden Temple in Amritsar',
    ],
  },
  {
    names: ['dubai', 'uae', 'united arab emirates'],
    title: 'Dubai',
    places: [
      'Burj Khalifa',
      'Dubai Mall',
      'Dubai Fountain',
      'Palm Jumeirah',
      'Museum of the Future',
      'Dubai Marina',
      'Jumeirah Beach',
      'Desert safari area',
      'Dubai Creek',
      'Global Village',
    ],
  },
  {
    names: ['japan'],
    title: 'Japan',
    places: [
      'Tokyo Skytree and Shibuya Crossing',
      'Senso-ji Temple',
      'Mount Fuji',
      'Fushimi Inari Shrine in Kyoto',
      'Arashiyama Bamboo Grove',
      'Osaka Castle',
      'Dotonbori',
      'Hiroshima Peace Memorial Park',
      'Nara Park',
      'Himeji Castle',
    ],
  },
  {
    names: ['france', 'paris'],
    title: 'France',
    places: [
      'Eiffel Tower',
      'Louvre Museum',
      'Notre-Dame Cathedral',
      'Arc de Triomphe',
      'Palace of Versailles',
      'Montmartre',
      'Seine River',
      'French Riviera',
      'Mont Saint-Michel',
      'Provence villages',
    ],
  },
  {
    names: ['thailand', 'bangkok'],
    title: 'Thailand',
    places: [
      'Bangkok',
      'Grand Palace Bangkok',
      'Wat Arun',
      'Wat Phra Kaew',
      'Chatuchak Weekend Market',
      'Chiang Mai',
      'Phuket',
      'Phi Phi Islands',
      'Ayutthaya Historical Park',
      'Krabi',
      'Pattaya',
      'Khao Yai National Park',
    ],
  },
];

const QA_DATABASE: QAItem[] = [
  {
    question: 'What are tourist places to visit in the USA?',
    answer: 'For a USA trip, LandMark can help you explore places city by city on the map. Popular tourist places to include are:\n\nNew York City: Statue of Liberty, Times Square, Central Park, Empire State Building, Metropolitan Museum of Art.\nWashington, DC: White House, National Mall, Lincoln Memorial, Smithsonian museums, U.S. Capitol.\nCalifornia: Golden Gate Bridge, Alcatraz Island, Hollywood, Disneyland, Yosemite National Park.\nNevada and Arizona: Las Vegas Strip, Grand Canyon, Hoover Dam, Antelope Canyon.\nFlorida: Walt Disney World, Miami Beach, Everglades National Park, Kennedy Space Center.\nOther famous picks: Yellowstone, Mount Rushmore, Niagara Falls, New Orleans French Quarter, Chicago Millennium Park.\n\nTip: search a city like New York, Washington DC, Los Angeles, Las Vegas, or Orlando in LandMark, then use the Tourist places filter.',
    keywords: ['usa', 'america', 'united states', 'us trip'],
  },
  {
    question: 'How do I find tourist places in LandMark?',
    answer: 'Use the search box to enter a city or landmark, then click Tourist places. The map and list will show nearby Wikipedia places that look like attractions, monuments, museums, parks, bridges, historic sites, and other tourist picks.',
    keywords: ['find places', 'tourist filter', 'search city', 'map', 'places nearby', 'landmarks nearby'],
  },
  {
    question: 'What is LandMark?',
    answer: 'LandMark is an exploration map for discovering nearby landmarks and tourist places. Search a city, move the map, choose Tourist places, and open a place to read its details from Wikipedia.',
    keywords: ['landmark', 'what', 'project', 'about'],
  },
  {
    question: 'How do I get started?',
    answer: 'To get started, run `pnpm install` and then `pnpm run dev` to start the development server.',
    keywords: ['start', 'getting started', 'how', 'begin'],
  },
  {
    question: 'What technology is used?',
    answer: 'LandMark uses React, TypeScript, Vite, Tailwind CSS, and other modern web technologies.',
    keywords: ['technology', 'tech', 'stack', 'tools'],
  },
  {
    question: 'How do I build for production?',
    answer: 'Run `pnpm run build` to create a production build.',
    keywords: ['build', 'production', 'deploy', 'prod'],
  },
  {
    question: 'Where can I find documentation?',
    answer: 'Check the project README and inline code comments for documentation.',
    keywords: ['documentation', 'docs', 'help', 'info'],
  },
];

async function fetchWikiSummary(query: string): Promise<WikiSummary | null> {
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '1',
    format: 'json',
    origin: '*',
  });
  const searchResponse = await fetch(`https://en.wikipedia.org/w/api.php?${searchParams.toString()}`);
  if (!searchResponse.ok) return null;
  const searchPayload = await searchResponse.json() as { query?: { search?: { title: string }[] } };
  const title = searchPayload.query?.search?.[0]?.title;
  if (!title) return null;

  const summaryResponse = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!summaryResponse.ok) return null;
  return await summaryResponse.json() as WikiSummary;
}

function formatWikiAnswer(summary: WikiSummary) {
  const location = summary.coordinates
    ? `\n\nLocation: ${summary.coordinates.lat.toFixed(4)}, ${summary.coordinates.lon.toFixed(4)}.`
    : '';
  const description = summary.description ? `${summary.description}\n\n` : '';
  return `${summary.title}\n\n${description}${summary.extract || 'Wikipedia does not have a short summary for this place yet.'}${location}`;
}

function isTravelQuestion(input: string) {
  return /\b(trip|tourist|place|places|visit|travel|vacation|suggest|cover|famous|where|what)\b/.test(input);
}

function getDestination(input: string, fallback?: DestinationGuide | null) {
  return DESTINATION_GUIDES.find((guide) =>
    guide.names.some((name) => input.includes(name))
  ) ?? (/\b(there|that place|it)\b/.test(input) ? fallback ?? null : null);
}

function getKnownPlace(input: string, destination?: DestinationGuide | null) {
  const guides = destination ? [destination] : DESTINATION_GUIDES;
  for (const guide of guides) {
    const place = guide.places.find((item) => {
      const lowerPlace = item.toLowerCase();
      return input.includes(lowerPlace) || input.includes(lowerPlace.split(' in ')[0]);
    });
    if (place) return place;
  }
  return null;
}

type ChatbotProps = {
  onSearchPlace?: (query: string) => void;
};

export function Chatbot({ onSearchPlace }: ChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! I\'m the LandMark assistant. Ask me about tourist places, USA trips, or how to use the map.',
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastDestination, setLastDestination] = useState<DestinationGuide | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const findBestAnswer = async (userInput: string): Promise<Message> => {
    const lowercaseInput = userInput.toLowerCase();

    const destination = getDestination(lowercaseInput, lastDestination);
    const knownPlace = getKnownPlace(lowercaseInput, destination);

    if (knownPlace && /\b(where|what|famous|about|tell|visit|place)\b/.test(lowercaseInput)) {
      const summary = await fetchWikiSummary(knownPlace);
      return {
        id: (Date.now() + 1).toString(),
        text: summary
          ? `${formatWikiAnswer(summary)}\n\nClick the place button below to show it in the LandMark search.`
          : `I found ${knownPlace}. Click the place button below to show it in the LandMark search.`,
        sender: 'bot',
        timestamp: new Date(),
        actions: [knownPlace],
      };
    }

    if (destination && isTravelQuestion(lowercaseInput)) {
      setLastDestination(destination);
      const summary = await fetchWikiSummary(destination.title);
      const intro = summary?.extract
        ? `${destination.title}: ${summary.extract}`
        : `For a ${destination.title} trip, these tourist places are good picks.`;
      return {
        id: (Date.now() + 1).toString(),
        text: `${intro}\n\nSelect a place to search it on the LandMark map:`,
        sender: 'bot',
        timestamp: new Date(),
        actions: destination.places,
      };
    }

    for (const qa of QA_DATABASE) {
      if (qa.keywords.some(keyword => lowercaseInput.includes(keyword))) {
        return {
          id: (Date.now() + 1).toString(),
          text: qa.answer,
          sender: 'bot',
          timestamp: new Date(),
        };
      }
    }

    if (isTravelQuestion(lowercaseInput)) {
      const cleanedQuery = userInput
        .replace(/\b(where is|what is|what are|famous|there|tourist places|suggest|visit|trip|travel|vacation|i want to go for|i want to go to)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanedQuery.length > 2) {
        const summary = await fetchWikiSummary(cleanedQuery);
        if (summary) {
          return {
            id: (Date.now() + 1).toString(),
            text: `${formatWikiAnswer(summary)}\n\nClick below to search it on the LandMark map.`,
            sender: 'bot',
            timestamp: new Date(),
            actions: [summary.title],
          };
        }
      }
      return {
        id: (Date.now() + 1).toString(),
        text: 'Tell me the country, city, or landmark name and I can suggest places. For example: "I want to go for Singapore, suggest tourist places" or "Where is Singapore Flyer?"',
        sender: 'bot',
        timestamp: new Date(),
      };
    }

    return {
      id: (Date.now() + 1).toString(),
      text: "I'm not sure about that yet. Try asking for tourist places in a country, city, or landmark.",
      sender: 'bot',
      timestamp: new Date(),
    };
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    setTimeout(async () => {
      const botMessage = await findBestAnswer(input);
      setMessages(prev => [...prev, botMessage]);
      setIsLoading(false);
    }, 500);
  };

  const handlePlaceAction = (place: string) => {
    onSearchPlace?.(place);
    setInput(place);
    setMessages(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        text: `Searching LandMark for ${place}.`,
        sender: 'bot',
        timestamp: new Date(),
      },
    ]);
  };

  return (
    <>
      {/* Floating Chat Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-4 z-[1000] bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-xl transition-all duration-200 hover:scale-110 md:bottom-8 md:right-6"
          aria-label="Open chatbot"
        >
          <MessageCircle size={25} />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <Card className="fixed bottom-24 right-4 z-[1000] flex h-[min(34rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden shadow-2xl bg-white md:bottom-8 md:right-6">
          {/* Header */}
          <div className="bg-blue-600 text-white p-4 flex justify-between items-center rounded-t-lg">
            <h2 className="font-bold text-lg flex items-center gap-2"><MessageCircle size={19} /> LandMark Assistant</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="hover:bg-blue-700 p-1 rounded transition-colors"
              aria-label="Close chatbot"
            >
              <X size={20} />
            </button>
          </div>

          {/* Messages Area */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.sender === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-xs px-3 py-2 rounded-lg ${
                      message.sender === 'user'
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'max-h-80 overflow-y-auto bg-gray-200 text-gray-800 rounded-bl-none'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-line">{message.text}</p>
                    {message.actions?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.actions.map((place) => (
                          <button
                            key={place}
                            type="button"
                            onClick={() => handlePlaceAction(place)}
                            className="rounded-md bg-white px-2 py-1 text-left text-xs font-medium text-blue-700 shadow-sm transition hover:bg-blue-50"
                          >
                            {place}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <span className="text-xs opacity-70 mt-1 block">
                      {message.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-200 text-gray-800 px-3 py-2 rounded-lg rounded-bl-none">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce delay-100" />
                      <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce delay-200" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <form onSubmit={handleSendMessage} className="border-t p-4 flex gap-2">
            <Input
              type="text"
              placeholder="Type your message..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              size="icon"
            >
              <Send size={18} />
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}
