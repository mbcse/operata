"use client";

import React from 'react';
import { Wallet, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import config from '../config';

const LandingPage = () => {
  const router = useRouter();
console.log(config.NOTION_AUTH_URL)
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="py-6 px-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-full">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold">Operata</span>
        </div>
        <nav>
          <ul className="flex gap-8">
            <li><a href="#" className="hover:text-blue-400 transition-colors">Home</a></li>
            <li><a href="#" className="hover:text-blue-400 transition-colors">Features</a></li>
            <li><a href="#" className="hover:text-blue-400 transition-colors">Documentation</a></li>
            {/* <li>
              <button
                onClick={() => open()}
                className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Connect Wallet
              </button>
            </li> */}
          </ul>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-6xl font-bold mb-6 leading-tight max-w-4xl">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-teal-500">
            Enterprise Wallet
          </span>
          <br />
          Powered by Notion
        </h1>
        
        <p className="text-gray-400 text-xl mb-12 max-w-2xl">
          Manage your enterprise crypto assets with the familiar interface of Notion. 
          Track transactions, manage permissions, and maintain compliance all in one place.
        </p>
        
        <div className="flex gap-4">
          {/* <button
            onClick={() => open()}
            className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            Connect Wallet
            <ArrowRight className="w-5 h-5" />
          </button> */}
          <button
            onClick={() => window.open(config.NOTION_AUTH_URL, '_blank')}
            className="px-6 py-3 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Connect Notion
          </button>
        </div>
      </main>

      {/* Features section */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-12 text-center">Why Choose Operata?</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-gray-900 p-6 rounded-xl">
              <div className="bg-blue-600 w-12 h-12 flex items-center justify-center rounded-full mb-4">
                <Wallet className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Familiar Interface</h3>
              <p className="text-gray-400">Manage crypto assets through Notion's intuitive interface.</p>
            </div>
            
            <div className="bg-gray-900 p-6 rounded-xl">
              <div className="bg-teal-600 w-12 h-12 flex items-center justify-center rounded-full mb-4">
                <Wallet className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Enterprise Ready</h3>
              <p className="text-gray-400">Multi-sig support, role-based access, and compliance tracking.</p>
            </div>
            
            <div className="bg-gray-900 p-6 rounded-xl">
              <div className="bg-indigo-600 w-12 h-12 flex items-center justify-center rounded-full mb-4">
                <Wallet className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Automated Tracking</h3>
              <p className="text-gray-400">Automatic transaction logging and real-time balance updates.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-gray-800">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center">
          <div className="flex items-center gap-2 mb-4 md:mb-0">
            <Wallet className="w-5 h-5 text-blue-500" />
            <span className="font-semibold">Operata</span> &copy; {new Date().getFullYear()}
          </div>
          
          <div className="text-gray-500 text-sm">
            Enterprise crypto management powered by Notion
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage; 