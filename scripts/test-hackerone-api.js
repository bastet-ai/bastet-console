#!/usr/bin/env node

/**
 * HackerOne API Test Script
 * 
 * This script tests fetching program data from HackerOne's public API
 * to understand what data is available for importing into campaigns.
 * 
 * HackerOne has a public API that doesn't require authentication for
 * accessing public program data.
 * 
 * API Documentation: https://api.hackerone.com/customer-resources/
 */

const https = require('https');

// Example public programs to test with
const TEST_PROGRAMS = [
  'security',      // HackerOne's own program
  'github',        // GitHub's program
  'shopify',       // Shopify's program
  'coinbase',      // Coinbase's program
];

/**
 * Fetch program data from HackerOne's public API
 */
function fetchHackerOneProgram(programHandle) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'hackerone.com',
      path: `/${programHandle}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Bastet-Console/1.0',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ html: data }); // If not JSON, return HTML
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * Try the GraphQL API endpoint
 */
function fetchHackerOneGraphQL(programHandle) {
  return new Promise((resolve, reject) => {
    const query = JSON.stringify({
      operationName: 'TeamProfile',
      variables: { handle: programHandle },
      query: `
        query TeamProfile($handle: String!) {
          team(handle: $handle) {
            handle
            name
            url
            currency
            state
            offers_bounties
            offers_swag
            submission_state
            triage_active
            about
            policy
            structured_scope_versions {
              max_updated_at
            }
            in_scope_assets: structured_scopes(
              first: 100,
              archived: false,
              eligible_for_submission: true
            ) {
              edges {
                node {
                  asset_identifier
                  asset_type
                  eligible_for_bounty
                  instruction
                  max_severity
                }
              }
            }
          }
        }
      `
    });

    const options = {
      hostname: 'hackerone.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'User-Agent': 'Bastet-Console/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': query.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(query);
    req.end();
  });
}

/**
 * Parse and display program information
 */
function displayProgramInfo(program, data) {
  console.log('\n='.repeat(60));
  console.log(`Program: ${program}`);
  console.log('='.repeat(60));

  if (data.data && data.data.team) {
    const team = data.data.team;
    
    console.log(`\nBasic Information:`);
    console.log(`  Name: ${team.name}`);
    console.log(`  Handle: ${team.handle}`);
    console.log(`  URL: ${team.url}`);
    console.log(`  State: ${team.state}`);
    console.log(`  Offers Bounties: ${team.offers_bounties}`);
    console.log(`  Submission State: ${team.submission_state}`);
    
    if (team.about) {
      console.log(`\nAbout:`);
      console.log(`  ${team.about.substring(0, 200)}...`);
    }
    
    if (team.policy) {
      console.log(`\nPolicy (Rules of Engagement):`);
      console.log(`  ${team.policy.substring(0, 200)}...`);
    }
    
    if (team.in_scope_assets && team.in_scope_assets.edges) {
      console.log(`\nIn-Scope Assets (${team.in_scope_assets.edges.length}):`);
      team.in_scope_assets.edges.slice(0, 5).forEach((edge, i) => {
        const node = edge.node;
        console.log(`  ${i + 1}. ${node.asset_identifier} (${node.asset_type})`);
        console.log(`     Eligible for Bounty: ${node.eligible_for_bounty}`);
        console.log(`     Max Severity: ${node.max_severity}`);
        if (node.instruction) {
          console.log(`     Instructions: ${node.instruction.substring(0, 80)}...`);
        }
      });
      
      if (team.in_scope_assets.edges.length > 5) {
        console.log(`  ... and ${team.in_scope_assets.edges.length - 5} more assets`);
      }
    }
    
    // Extract scope for Bastet campaign
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`EXTRACTED DATA FOR BASTET CAMPAIGN:`);
    console.log(`${'*'.repeat(60)}`);
    console.log(`Campaign Name: ${team.name}`);
    console.log(`Description: ${team.about || 'Security assessment program'}`);
    console.log(`\nScope (for scanning):`);
    if (team.in_scope_assets && team.in_scope_assets.edges) {
      const scope = team.in_scope_assets.edges.map(edge => edge.node.asset_identifier).join('\n');
      console.log(scope);
    }
    console.log(`\nRules of Engagement:`);
    console.log(team.policy || 'See program policy');
    
  } else if (data.errors) {
    console.log(`\nErrors:`);
    data.errors.forEach(error => {
      console.log(`  - ${error.message}`);
    });
  } else {
    console.log(`\nReceived HTML response (program may not be public)`);
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('HackerOne API Test Script');
  console.log('Testing public program data access...\n');

  for (const program of TEST_PROGRAMS) {
    try {
      console.log(`\nFetching data for program: ${program}...`);
      const data = await fetchHackerOneGraphQL(program);
      displayProgramInfo(program, data);
      
      // Add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`\nError fetching ${program}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete!');
  console.log('='.repeat(60));
}

// Run the test
main().catch(console.error);

