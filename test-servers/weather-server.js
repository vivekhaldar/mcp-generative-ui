#!/usr/bin/env node
// ABOUTME: Simple mock weather MCP server for testing.
// ABOUTME: Returns fake weather data for any city - no API key needed.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "weather-server",
  version: "1.0.0",
});

// Mock weather data generator
function generateWeather(city) {
  const conditions = ["Sunny", "Partly Cloudy", "Cloudy", "Rainy", "Thunderstorms", "Snowy", "Foggy"];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];
  const temp = Math.floor(Math.random() * 35) + 40; // 40-75°F
  const humidity = Math.floor(Math.random() * 50) + 30; // 30-80%
  const wind = Math.floor(Math.random() * 20) + 5; // 5-25 mph

  return {
    city,
    temperature: temp,
    temperatureUnit: "F",
    condition,
    humidity,
    windSpeed: wind,
    windUnit: "mph",
    timestamp: new Date().toISOString(),
  };
}

// Generate 5-day forecast
function generateForecast(city) {
  const days = [];
  const conditions = ["Sunny", "Partly Cloudy", "Cloudy", "Rainy", "Thunderstorms"];

  for (let i = 0; i < 5; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    days.push({
      date: date.toISOString().split("T")[0],
      dayName: date.toLocaleDateString("en-US", { weekday: "long" }),
      high: Math.floor(Math.random() * 20) + 60,
      low: Math.floor(Math.random() * 15) + 40,
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      precipChance: Math.floor(Math.random() * 100),
    });
  }

  return { city, forecast: days };
}

// Register tools
server.tool(
  "get_current_weather",
  "Get the current weather conditions for a city",
  { city: z.string().describe("The city name (e.g., 'San Francisco', 'New York')") },
  async ({ city }) => {
    const weather = generateWeather(city);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(weather, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "get_forecast",
  "Get a 5-day weather forecast for a city",
  { city: z.string().describe("The city name (e.g., 'San Francisco', 'New York')") },
  async ({ city }) => {
    const forecast = generateForecast(city);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(forecast, null, 2),
        },
      ],
    };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Weather MCP server running on stdio");
